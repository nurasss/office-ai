import {
  env,
  AppError,
  ERROR_CODES,
  conflict,
  notFound,
  hashPassword,
  verifyPassword,
  sha256Hex,
  DUMMY_PASSWORD_HASH,
  parseDurationSeconds,
  type OrgRole,
} from '@ai-company/shared'
import { withTransaction } from '@ai-company/db'
import type { AppDeps } from '../deps.js'
import { TokenService, type TokenMeta } from './token-service.js'

export interface RegisterInput {
  email: string
  password: string
  name: string
  organizationName: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface AuthOrganization {
  id: string
  name: string
  slug: string
  role: OrgRole
}

export interface AuthResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: {
    id: string
    email: string
    name: string
  }
  organizations: AuthOrganization[]
}

export interface MeResponse {
  user: {
    id: string
    email: string
    name: string
    status: string
    createdAt: Date
  }
  organizations: AuthOrganization[]
  currentOrg?: AuthOrganization | undefined
}

export function slugify(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

  return normalized || 'org'
}

export class AuthService {
  private readonly tokenService: TokenService

  constructor(private readonly deps: AppDeps) {
    this.tokenService = new TokenService(deps)
  }

  async register(input: RegisterInput, meta?: TokenMeta): Promise<AuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim()

    // 1. Check email availability
    const existingUser = await this.deps.repos.auth.findUserByEmail(normalizedEmail)
    if (existingUser) {
      throw conflict(ERROR_CODES.EMAIL_ALREADY_EXISTS, 'User with this email already exists', {
        email: normalizedEmail,
      })
    }

    // 2. Generate unique slug
    const baseSlug = slugify(input.organizationName)
    let chosenSlug: string | null = null

    for (let attempt = 1; attempt <= 50; attempt++) {
      const candidateSlug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`
      const existingOrg = await this.deps.repos.auth.findOrganizationBySlug(candidateSlug)
      if (!existingOrg) {
        chosenSlug = candidateSlug
        break
      }
    }

    if (!chosenSlug) {
      throw conflict(
        ERROR_CODES.SLUG_ALREADY_EXISTS,
        'Failed to generate unique organization slug after 50 attempts',
        { organizationName: input.organizationName },
      )
    }

    const passwordHash = await hashPassword(input.password)

    // 3. Execute atomic creation in a transaction
    const { user, org, member } = await withTransaction(this.deps.db, async (tx) => {
      const userRow = await this.deps.repos.auth.createUser(
        {
          email: normalizedEmail,
          passwordHash,
          name: input.name.trim(),
          status: 'active',
        },
        tx,
      )

      const orgRow = await this.deps.repos.auth.createOrganization(
        {
          name: input.organizationName.trim(),
          slug: chosenSlug,
          plan: 'free',
          status: 'active',
        },
        tx,
      )

      const memberRow = await this.deps.repos.auth.addMember(orgRow.id, userRow.id, 'owner', tx)

      // Platform-level audit log entry inside transaction
      await this.deps.repos.auditLogs.appendPlatform(
        {
          clock: this.deps.clock,
          ids: this.deps.ids,
          actorType: 'user',
          actorId: userRow.id,
          action: 'auth.register',
          resourceType: 'user',
          resourceId: userRow.id,
          metadata: { organizationId: orgRow.id, slug: chosenSlug },
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        },
        tx,
      )

      return { user: userRow, org: orgRow, member: memberRow }
    })

    // 4. Issue tokens
    const accessToken = await this.tokenService.issueAccessToken(user.id)
    const { token: refreshToken } = await this.tokenService.issueRefreshToken(user.id, meta)
    const expiresIn = parseDurationSeconds(env.JWT_ACCESS_TTL)

    return {
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      organizations: [
        {
          id: org.id,
          name: org.name,
          slug: org.slug,
          role: member.role as OrgRole,
        },
      ],
    }
  }

  async login(input: LoginInput, meta?: TokenMeta): Promise<AuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim()
    const user = await this.deps.repos.auth.findUserByEmail(normalizedEmail)

    // Constant-time execution when user not found
    if (!user) {
      await verifyPassword(DUMMY_PASSWORD_HASH, input.password)

      try {
        await this.deps.repos.auditLogs.appendPlatform({
          clock: this.deps.clock,
          ids: this.deps.ids,
          actorType: 'system',
          actorId: null,
          action: 'auth.login_failed',
          resourceType: 'user',
          resourceId: null,
          metadata: {
            reason: 'unknown_email',
            emailHash: sha256Hex(normalizedEmail),
          },
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        })
      } catch (err) {
        this.deps.logger.error({ msg: 'Failed to record audit log for login failure', err })
      }

      throw new AppError({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        httpStatus: 401,
        message: 'Invalid email or password',
      })
    }

    const isValidPassword = await verifyPassword(user.passwordHash, input.password)
    if (!isValidPassword) {
      try {
        await this.deps.repos.auditLogs.appendPlatform({
          clock: this.deps.clock,
          ids: this.deps.ids,
          actorType: 'user',
          actorId: user.id,
          action: 'auth.login_failed',
          resourceType: 'user',
          resourceId: user.id,
          metadata: { reason: 'invalid_password' },
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        })
      } catch (err) {
        this.deps.logger.error({ msg: 'Failed to record audit log for login failure', err })
      }

      throw new AppError({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        httpStatus: 401,
        message: 'Invalid email or password',
      })
    }

    if (user.status === 'disabled') {
      try {
        await this.deps.repos.auditLogs.appendPlatform({
          clock: this.deps.clock,
          ids: this.deps.ids,
          actorType: 'user',
          actorId: user.id,
          action: 'auth.login_failed',
          resourceType: 'user',
          resourceId: user.id,
          metadata: { reason: 'account_disabled' },
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        })
      } catch (err) {
        this.deps.logger.error({ msg: 'Failed to record audit log for login failure', err })
      }

      throw new AppError({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        httpStatus: 401,
        message: 'Invalid email or password',
      })
    }

    // Success: update last login and record platform audit log
    await this.deps.repos.auth.updateUserLastLogin(user.id, this.deps.clock.now())
    const orgs = await this.deps.repos.auth.listUserOrganizations(user.id)

    try {
      await this.deps.repos.auditLogs.appendPlatform({
        clock: this.deps.clock,
        ids: this.deps.ids,
        actorType: 'user',
        actorId: user.id,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { email: user.email },
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for login success', err })
    }

    const accessToken = await this.tokenService.issueAccessToken(user.id)
    const { token: refreshToken } = await this.tokenService.issueRefreshToken(user.id, meta)
    const expiresIn = parseDurationSeconds(env.JWT_ACCESS_TTL)

    return {
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        role: o.memberRole,
      })),
    }
  }

  async refresh(refreshToken: string, meta?: TokenMeta): Promise<AuthResult> {
    const { access, refresh } = await this.tokenService.rotateRefreshToken(refreshToken, meta)
    const { sub: userId } = await this.tokenService.verifyAccessToken(access)

    const user = await this.deps.repos.auth.findUserById(userId)
    if (!user || user.status !== 'active') {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        httpStatus: 401,
        message: 'User account is inactive or not found',
      })
    }

    const orgs = await this.deps.repos.auth.listUserOrganizations(user.id)
    const expiresIn = parseDurationSeconds(env.JWT_ACCESS_TTL)

    return {
      accessToken: access,
      refreshToken: refresh,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        role: o.memberRole,
      })),
    }
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revokeRefreshToken(refreshToken)
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokenService.revokeAllForUser(userId)
  }

  async getMe(userId: string, currentOrgId?: string): Promise<MeResponse> {
    const user = await this.deps.repos.auth.findUserById(userId)
    if (!user) {
      throw notFound('User', userId)
    }

    const orgs = await this.deps.repos.auth.listUserOrganizations(user.id)
    const organizations: AuthOrganization[] = orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      role: o.memberRole,
    }))

    let currentOrg: AuthOrganization | undefined
    if (currentOrgId) {
      currentOrg = organizations.find((o) => o.id === currentOrgId)
    } else if (organizations.length === 1) {
      currentOrg = organizations[0]
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        createdAt: user.createdAt,
      },
      organizations,
      currentOrg,
    }
  }
}

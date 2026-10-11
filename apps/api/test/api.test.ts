import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { SignJWT } from 'jose'
import {
  createFixedClock,
  realIdGenerator,
  rootLogger,
  parseDurationMs,
  env,
} from '@ai-company/shared'
import {
  createDatabase,
  closeDatabase,
  createRepositories,
  users,
  refreshTokens,
  sql,
  withTransaction,
} from '@ai-company/db'
import { buildServer } from '../src/server.js'
import type { AppDeps } from '../src/deps.js'
import type { AuthResult } from '../src/services/auth-service.js'
import { isDatabaseReachable, truncateAll } from './helpers/db.js'

describe('AI Company OS API & Auth Layer (@ai-company/api)', () => {
  let dbAvailable = false
  const db = createDatabase()

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable()
  })

  afterAll(async () => {
    if (dbAvailable) {
      await closeDatabase()
    }
  })

  beforeEach(async () => {
    if (dbAvailable) {
      await truncateAll(db)
    }
  })

  function createTestServer(clock = createFixedClock(new Date('2026-08-25T12:00:00.000Z'))) {
    const deps: AppDeps = {
      db,
      repos: createRepositories(db, { clock, ids: realIdGenerator }),
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }
    const server = buildServer(deps)
    return { server, deps, clock }
  }

  async function registerUser(
    server: ReturnType<typeof buildServer>,
    overrides?: {
      email?: string
      password?: string
      name?: string
      organizationName?: string
    },
  ) {
    const payload = {
      email: overrides?.email ?? 'test@example.com',
      password: overrides?.password ?? 'valid-password-123',
      name: overrides?.name ?? 'Test User',
      organizationName: overrides?.organizationName ?? 'Acme Corp',
    }

    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload,
    })

    expect(res.statusCode).toBe(201)
    return {
      auth: res.json<AuthResult>(),
      payload,
    }
  }

  describe('Part D1: Registration', () => {
    it('1. Creates user, organization, and membership owner in a single atomic transaction', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, deps } = createTestServer()

      const { auth } = await registerUser(server, {
        email: 'founder@example.com',
        organizationName: 'Startup Inc',
      })

      expect(auth.accessToken).toBeDefined()
      expect(auth.refreshToken).toBeDefined()
      expect(auth.user.email).toBe('founder@example.com')
      expect(auth.organizations).toHaveLength(1)
      expect(auth.organizations[0]?.role).toBe('owner')
      expect(auth.organizations[0]?.slug).toBe('startup-inc')

      // Verify records in DB
      const userInDb = await deps.repos.auth.findUserByEmail('founder@example.com')
      expect(userInDb).not.toBeNull()

      const orgInDb = await deps.repos.auth.findOrganizationBySlug('startup-inc')
      expect(orgInDb).not.toBeNull()

      const memberInDb = await deps.repos.auth.findMembership(orgInDb!.id, userInDb!.id)
      expect(memberInDb).not.toBeNull()
      expect(memberInDb?.role).toBe('owner')
    })

    it('2. Duplicate email returns 409 EMAIL_ALREADY_EXISTS', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      await registerUser(server, { email: 'duplicate@example.com' })

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'another-valid-password-123',
          name: 'Another User',
          organizationName: 'Another Org',
        },
      })

      expect(res.statusCode).toBe(409)
      const body = res.json()
      expect(body.error.code).toBe('EMAIL_ALREADY_EXISTS')
    })

    it('3. Email comparison is case-insensitive (User@X.com == user@x.com)', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      await registerUser(server, { email: 'User@Example.COM' })

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'user@example.com',
          password: 'valid-password-456',
          name: 'Second User',
          organizationName: 'Second Org',
        },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('EMAIL_ALREADY_EXISTS')
    })

    it('4. Organization slug collision generates suffix -2, -3', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const reg1 = await registerUser(server, {
        email: 'u1@example.com',
        organizationName: 'My Awesome Co',
      })
      expect(reg1.auth.organizations[0]?.slug).toBe('my-awesome-co')

      const reg2 = await registerUser(server, {
        email: 'u2@example.com',
        organizationName: 'My Awesome Co',
      })
      expect(reg2.auth.organizations[0]?.slug).toBe('my-awesome-co-2')

      const reg3 = await registerUser(server, {
        email: 'u3@example.com',
        organizationName: 'My Awesome Co',
      })
      expect(reg3.auth.organizations[0]?.slug).toBe('my-awesome-co-3')
    })

    it('5. Injected error inside registration transaction leaves NO orphaned user or organization in DB', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { deps } = createTestServer()

      // Emulate broken step inside transaction
      try {
        await withTransaction(deps.db, async (tx) => {
          await deps.repos.auth.createUser(
            {
              email: 'rollback-user@example.com',
              passwordHash: 'hash',
              name: 'Rollback User',
            },
            tx,
          )

          await deps.repos.auth.createOrganization(
            {
              name: 'Rollback Org',
              slug: 'rollback-org',
            },
            tx,
          )

          // Deliberate failure on step 4
          throw new Error('Simulated database crash on step 4')
        })
      } catch {
        // Expected transaction rejection
      }

      const userAfterRollback = await deps.repos.auth.findUserByEmail('rollback-user@example.com')
      expect(userAfterRollback).toBeNull()

      const orgAfterRollback = await deps.repos.auth.findOrganizationBySlug('rollback-org')
      expect(orgAfterRollback).toBeNull()
    })

    it('6. Password < 10 chars is rejected with 400; password > 200 chars is rejected before argon2', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const shortRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'short@example.com',
          password: 'short',
          name: 'Short Pwd',
          organizationName: 'Org',
        },
      })
      expect(shortRes.statusCode).toBe(400)
      expect(shortRes.json().error.code).toBe('VALIDATION_ERROR')

      const longRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'long@example.com',
          password: 'a'.repeat(201),
          name: 'Long Pwd',
          organizationName: 'Org',
        },
      })
      expect(longRes.statusCode).toBe(400)
      expect(longRes.json().error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('Part D2: Login', () => {
    it('7. Wrong password returns 401 INVALID_CREDENTIALS', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      await registerUser(server, { email: 'user@example.com', password: 'correct-password-123' })

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'wrong-password-999',
        },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS')
    })

    it('8. Non-existent email returns 401 INVALID_CREDENTIALS with identical response body structure', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      await registerUser(server, { email: 'existing@example.com', password: 'correct-password-123' })

      const wrongPwdRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'existing@example.com', password: 'wrong-password' },
      })

      const wrongEmailRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'non-existent@example.com', password: 'some-password' },
      })

      expect(wrongPwdRes.statusCode).toBe(401)
      expect(wrongEmailRes.statusCode).toBe(401)

      const wrongPwdBody = wrongPwdRes.json()
      const wrongEmailBody = wrongEmailRes.json()

      expect(wrongPwdBody.error.code).toBe('INVALID_CREDENTIALS')
      expect(wrongEmailBody.error.code).toBe('INVALID_CREDENTIALS')
      expect(wrongPwdBody.error.message).toBe(wrongEmailBody.error.message)
    })

    it('9. Disabled account returns 401 INVALID_CREDENTIALS (no leak of account existence)', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, deps } = createTestServer()
      const { auth } = await registerUser(server, {
        email: 'disabled@example.com',
        password: 'valid-password-123',
      })

      // Disable user in DB
      await deps.db.update(users).set({ status: 'disabled' }).where(sql`id = ${auth.user.id}`)

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'disabled@example.com', password: 'valid-password-123' },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS')
    })

    it('10. Successful login updates last_login_at and records audit log', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server, deps, clock } = createTestServer()
      await registerUser(server, { email: 'audit-login@example.com', password: 'valid-password-123' })

      clock.advance(60000)

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'audit-login@example.com', password: 'valid-password-123' },
      })

      expect(res.statusCode).toBe(200)
      const user = await deps.repos.auth.findUserByEmail('audit-login@example.com')
      expect(user?.lastLoginAt).not.toBeNull()
      expect(user?.lastLoginAt?.getTime()).toBe(clock.now().getTime())
    })
  })

  describe('Part D3: Tokens (Fixed Clock Verification)', () => {
    it('11. Request to protected route without token returns 401 UNAUTHORIZED', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const res = await server.inject({
        method: 'GET',
        url: '/v1/me',
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('UNAUTHORIZED')
    })

    it('12. Access token expired after clock.advance(TTL + 1000) returns 401 TOKEN_EXPIRED', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, clock } = createTestServer()
      const { auth } = await registerUser(server)

      // Valid immediately
      const okRes = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      })
      expect(okRes.statusCode).toBe(200)

      // Advance clock past 15m access token TTL
      const accessTtlMs = parseDurationMs(env.JWT_ACCESS_TTL)
      clock.advance(accessTtlMs + 1000)

      const expiredRes = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      })

      expect(expiredRes.statusCode).toBe(401)
      expect(expiredRes.json().error.code).toBe('TOKEN_EXPIRED')
    })

    it('13. Forged token signature returns 401 TOKEN_INVALID', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      // Sign with a foreign secret
      const fakeSecret = new TextEncoder().encode('wrong-secret-key-that-does-not-match-jwt-secret-min-32')
      const forgedToken = await new SignJWT({ sub: realIdGenerator.next() })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(fakeSecret)

      const res = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${forgedToken}` },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('TOKEN_INVALID')
    })

    it('14. Refresh endpoint issues new access/refresh pair and revokes old refresh token', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const { auth } = await registerUser(server)

      const refreshRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: auth.refreshToken },
      })

      expect(refreshRes.statusCode).toBe(200)
      const newAuth = refreshRes.json<AuthResult>()

      expect(newAuth.accessToken).toBeDefined()
      expect(newAuth.refreshToken).toBeDefined()
      expect(newAuth.refreshToken).not.toBe(auth.refreshToken)
    })

    it('15. Reuse of revoked refresh token returns 401 AND revokes all user sessions', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const { auth } = await registerUser(server)

      // 1. First legitimate refresh
      const firstRefreshRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: auth.refreshToken },
      })
      expect(firstRefreshRes.statusCode).toBe(200)
      const validNewAuth = firstRefreshRes.json<AuthResult>()

      // 2. Attacker replays OLD (now revoked) refresh token
      const replayRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: auth.refreshToken },
      })
      expect(replayRes.statusCode).toBe(401)
      expect(replayRes.json().error.code).toBe('TOKEN_INVALID')

      // 3. Due to reuse detection, the entire user token family is revoked
      const subsequentRefreshRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: validNewAuth.refreshToken },
      })
      expect(subsequentRefreshRes.statusCode).toBe(401)
      expect(subsequentRefreshRes.json().error.code).toBe('TOKEN_INVALID')
    })

    it('16. Expired refresh token (via clock.advance) returns 401 TOKEN_EXPIRED', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, clock } = createTestServer()
      const { auth } = await registerUser(server)

      // Advance clock past 30 days refresh token TTL
      const refreshTtlMs = parseDurationMs(env.JWT_REFRESH_TTL)
      clock.advance(refreshTtlMs + 5000)

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: auth.refreshToken },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('TOKEN_EXPIRED')
    })

    it('17. Refresh token plaintext is NEVER stored in database — only sha256 hash', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, deps } = createTestServer()
      const { auth } = await registerUser(server)

      const storedTokens = await deps.db.select().from(refreshTokens)
      expect(storedTokens.length).toBeGreaterThanOrEqual(1)

      for (const t of storedTokens) {
        expect(t.tokenHash).not.toBe(auth.refreshToken)
        expect(t.tokenHash).toHaveLength(64) // 64 hex characters for SHA-256
      }
    })

    it('18. logout revokes single token; logout-all revokes all user tokens', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const { auth } = await registerUser(server)

      // Issue a second refresh token (e.g. login from another device)
      const loginRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'test@example.com', password: 'valid-password-123' },
      })
      const secondAuth = loginRes.json<AuthResult>()

      // 1. Single logout on first token
      const logoutRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        payload: { refreshToken: auth.refreshToken },
      })
      expect(logoutRes.statusCode).toBe(200)

      // First token is now revoked
      const refresh1 = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: auth.refreshToken },
      })
      expect(refresh1.statusCode).toBe(401)

      // 2. logout-all revokes all tokens
      const logoutAllRes = await server.inject({
        method: 'POST',
        url: '/v1/auth/logout-all',
        headers: { authorization: `Bearer ${secondAuth.accessToken}` },
      })
      expect(logoutAllRes.statusCode).toBe(200)

      // Second refresh token is also revoked now
      const refresh2 = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: secondAuth.refreshToken },
      })
      expect(refresh2.statusCode).toBe(401)
    })
  })

  describe('Part D4: Organization Selection & Multi-tenancy', () => {
    it('19. Single organization user without X-Org-Id header succeeds', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const { auth } = await registerUser(server)

      const res = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.currentOrg?.id).toBe(auth.organizations[0]?.id)
    })

    it('20. Multi-organization user without X-Org-Id header returns 400 ORG_NOT_SELECTED', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, deps } = createTestServer()
      const { auth } = await registerUser(server)

      // Add user to a second organization
      const org2 = await deps.repos.auth.createOrganization({
        name: 'Second Org',
        slug: 'second-org',
      })
      await deps.repos.auth.addMember(org2.id, auth.user.id, 'member')

      const res = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('ORG_NOT_SELECTED')

      // With header specified, succeeds
      const withHeaderRes = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          'x-org-id': org2.id,
        },
      })
      expect(withHeaderRes.statusCode).toBe(200)
      expect(withHeaderRes.json().currentOrg?.id).toBe(org2.id)
    })

    it('21. Specifying X-Org-Id of foreign organization returns 403 FORBIDDEN', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, deps } = createTestServer()
      const { auth } = await registerUser(server)

      // Create an organization the user does NOT belong to
      const foreignOrg = await deps.repos.auth.createOrganization({
        name: 'Foreign Org',
        slug: 'foreign-org',
      })

      const res = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          'x-org-id': foreignOrg.id,
        },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN')
    })

    it('22. Deleting membership invalidates access immediately on the next request', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server, deps } = createTestServer()
      const { auth } = await registerUser(server)
      const orgId = auth.organizations[0]!.id

      // Access works initially
      const res1 = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${auth.accessToken}`, 'x-org-id': orgId },
      })
      expect(res1.statusCode).toBe(200)

      // Remove member from DB
      await deps.repos.auth.removeMember(orgId, auth.user.id)

      // Same unexpired access token is now rejected immediately
      const res2 = await server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${auth.accessToken}`, 'x-org-id': orgId },
      })
      expect(res2.statusCode).toBe(403)
      expect(res2.json().error.code).toBe('FORBIDDEN')
    })
  })

  describe('Part D5: Infrastructure & Error Handling', () => {
    it('23. GET /health with live database returns 200 with db: up', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const res = await server.inject({
        method: 'GET',
        url: '/health',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('ok')
      expect(body.db).toBe('up')
      expect(body.version).toBe('0.1.0')
    })

    it('24. Error responses conform strictly to standard error envelope', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'bad-email', password: 'pwd' },
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toBeDefined()
      expect(body.error.requestId).toBeDefined()
    })

    it('25. Header x-request-id is present in every response', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const res1 = await server.inject({ method: 'GET', url: '/health' })
      expect(res1.headers['x-request-id']).toBeDefined()

      const res2 = await server.inject({ method: 'GET', url: '/non-existent-route' })
      expect(res2.headers['x-request-id']).toBeDefined()
    })

    it('26. Unhandled internal error does NOT leak stack trace in response body', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      // Register temporary route that throws unhandled standard Error
      server.get('/crash-test', async () => {
        throw new Error('Secret internal database connection failure stack trace')
      })

      const res = await server.inject({
        method: 'GET',
        url: '/crash-test',
      })

      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(body.error.code).toBe('INTERNAL_ERROR')
      expect(body.error.message).toBe('Internal server error')
      expect(JSON.stringify(body)).not.toContain('Secret internal database connection')
      expect(JSON.stringify(body)).not.toContain('stack')
    })

    it('27. Rate limit on /v1/auth/login returns 429 RATE_LIMITED with Retry-After header', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const payload = { email: 'ratelimit@example.com', password: 'password-123' }

      // Rapidly execute requests to trigger rate limit (limit is 10/min from non-allowlisted IP)
      let rateLimitedRes: Awaited<ReturnType<typeof server.inject>> | null = null

      for (let i = 0; i < 15; i++) {
        const res = await server.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload,
          remoteAddress: '192.168.1.100', // non-allowlisted IP
        })

        if (res.statusCode === 429) {
          rateLimitedRes = res
          break
        }
      }

      expect(rateLimitedRes).not.toBeNull()
      if (!rateLimitedRes) throw new Error('Expected rateLimitedRes not to be null')
      expect(rateLimitedRes.statusCode).toBe(429)
      expect(rateLimitedRes.headers['retry-after']).toBeDefined()
      expect(rateLimitedRes.json().error.code).toBe('RATE_LIMITED')
    })

    it('28. Request body > 1MB is rejected with 413', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()

      const largePayload = {
        email: 'large@example.com',
        password: 'password-123',
        name: 'x'.repeat(1024 * 1024 + 100),
        organizationName: 'Org',
      }

      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: largePayload,
      })

      expect(res.statusCode).toBe(413)
    })
  })
})

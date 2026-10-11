import { eq, and, sql, count } from 'drizzle-orm'
import { notFound } from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { users, type User } from '../schema/auth.js'
import {
  organizations,
  organizationMembers,
  type Organization,
  type OrganizationMember,
} from '../schema/org.js'
import type { DbOrTx, RepoDeps } from './types.js'

export type OrgMemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface CreateUserInput {
  id?: string
  email: string
  passwordHash: string
  name: string
  status?: 'active' | 'disabled'
}

export interface CreateOrgInput {
  id?: string
  name: string
  slug: string
  plan?: 'free' | 'pro' | 'enterprise'
  monthlyBudgetUsd?: string
  status?: 'active' | 'suspended'
}

export class AuthRepository {
  constructor(
    private readonly db: Database,
    private readonly deps: RepoDeps,
  ) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async findUserById(id: string, tx?: Tx): Promise<User | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor.select().from(users).where(eq(users.id, id)).limit(1)
    return row ?? null
  }

  async findUserByEmail(email: string, tx?: Tx): Promise<User | null> {
    const executor = this.getExecutor(tx)
    const normalizedEmail = email.toLowerCase().trim()
    const [row] = await executor
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1)

    return row ?? null
  }

  async createUser(input: CreateUserInput, tx?: Tx): Promise<User> {
    const executor = this.getExecutor(tx)
    const now = this.deps.clock.now()
    const id = input.id ?? this.deps.ids.next()
    const normalizedEmail = input.email.toLowerCase().trim()

    const [row] = await executor
      .insert(users)
      .values({
        id,
        email: normalizedEmail,
        passwordHash: input.passwordHash,
        name: input.name,
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create user')
    }

    return row
  }

  async updateUserLastLogin(userId: string, at: Date, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    await executor
      .update(users)
      .set({
        lastLoginAt: at,
        updatedAt: this.deps.clock.now(),
      })
      .where(eq(users.id, userId))
  }

  async createOrganization(input: CreateOrgInput, tx?: Tx): Promise<Organization> {
    const executor = this.getExecutor(tx)
    const now = this.deps.clock.now()
    const id = input.id ?? this.deps.ids.next()

    const [row] = await executor
      .insert(organizations)
      .values({
        id,
        name: input.name,
        slug: input.slug,
        plan: input.plan ?? 'free',
        monthlyBudgetUsd: input.monthlyBudgetUsd ?? '100.000000',
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create organization')
    }

    return row
  }

  async findOrganizationById(id: string, tx?: Tx): Promise<Organization | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1)

    return row ?? null
  }

  async findOrganizationBySlug(slug: string, tx?: Tx): Promise<Organization | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1)

    return row ?? null
  }

  async addMember(
    orgId: string,
    userId: string,
    role: OrgMemberRole,
    tx?: Tx,
  ): Promise<OrganizationMember> {
    const executor = this.getExecutor(tx)
    const now = this.deps.clock.now()
    const id = this.deps.ids.next()

    const [row] = await executor
      .insert(organizationMembers)
      .values({
        id,
        orgId,
        userId,
        role,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to add organization member')
    }

    return row
  }

  async findMembership(orgId: string, userId: string, tx?: Tx): Promise<OrganizationMember | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
      .limit(1)

    return row ?? null
  }

  async listUserOrganizations(
    userId: string,
    tx?: Tx,
  ): Promise<Array<Organization & { memberRole: OrgMemberRole }>> {
    const executor = this.getExecutor(tx)
    const rows = await executor
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        plan: organizations.plan,
        monthlyBudgetUsd: organizations.monthlyBudgetUsd,
        status: organizations.status,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        memberRole: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(eq(organizationMembers.userId, userId))

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan: r.plan,
      monthlyBudgetUsd: r.monthlyBudgetUsd,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      memberRole: r.memberRole as OrgMemberRole,
    }))
  }

  async listMembers(
    orgId: string,
    tx?: Tx,
  ): Promise<Array<OrganizationMember & { user: User }>> {
    const executor = this.getExecutor(tx)
    const rows = await executor
      .select({
        member: organizationMembers,
        user: users,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.orgId, orgId))

    return rows.map((r) => ({
      ...r.member,
      user: r.user,
    }))
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    role: OrgMemberRole,
    tx?: Tx,
  ): Promise<OrganizationMember> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .update(organizationMembers)
      .set({
        role,
        updatedAt: this.deps.clock.now(),
      })
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
      .returning()

    if (!row) {
      throw notFound('OrganizationMember', `${orgId}:${userId}`)
    }

    return row
  }

  async removeMember(orgId: string, userId: string, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    await executor
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
  }

  async countOwners(orgId: string, tx?: Tx): Promise<number> {
    const executor = this.getExecutor(tx)
    const [result] = await executor
      .select({ count: count() })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, 'owner')))

    return Number(result?.count ?? 0)
  }
}

import { eq, and, desc, sql, isNull, ne, count } from 'drizzle-orm'
import {
  notFound,
  encodeCursor,
  decodeCursor,
  paginationQuerySchema,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { agents, type Agent } from '../schema/company.js'
import type { Ctx, DbOrTx } from './types.js'

export interface AgentFilter {
  companyId?: string | undefined
  departmentId?: string | null | undefined
  status?: ('draft' | 'active' | 'paused' | 'retired') | undefined
  managerAgentId?: string | null | undefined
}

export interface CreateAgentInput {
  companyId: string
  departmentId?: string | null | undefined
  managerAgentId?: string | null | undefined
  name: string
  role: string
  title: string
  systemPrompt: string
  systemPromptVersion?: number | undefined
  maxAutonomyLevel?: number | undefined
  monthlyBudgetUsd?: string | undefined
  status?: ('draft' | 'active' | 'paused' | 'retired') | undefined
  avatarUrl?: string | null | undefined
}

export interface UpdateAgentInput {
  departmentId?: string | null | undefined
  managerAgentId?: string | null | undefined
  name?: string | undefined
  role?: string | undefined
  title?: string | undefined
  systemPrompt?: string | undefined
  systemPromptVersion?: number | undefined
  maxAutonomyLevel?: number | undefined
  monthlyBudgetUsd?: string | undefined
  status?: ('draft' | 'active' | 'paused' | 'retired') | undefined
  avatarUrl?: string | null | undefined
}

export class AgentRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async findById(ctx: Ctx, id: string, tx?: Tx): Promise<Agent | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(agents)
      .where(and(eq(agents.orgId, ctx.orgId), eq(agents.id, id)))
      .limit(1)

    return row ?? null
  }

  async findByIdOrThrow(ctx: Ctx, id: string, tx?: Tx): Promise<Agent> {
    const row = await this.findById(ctx, id, tx)
    if (!row) {
      throw notFound('Agent', id)
    }
    return row
  }

  async findByName(ctx: Ctx, companyId: string, name: string, tx?: Tx): Promise<Agent | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.orgId, ctx.orgId),
          eq(agents.companyId, companyId),
          eq(agents.name, name),
        ),
      )
      .limit(1)

    return row ?? null
  }

  async findCeo(ctx: Ctx, companyId: string, tx?: Tx): Promise<Agent | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.orgId, ctx.orgId),
          eq(agents.companyId, companyId),
          isNull(agents.managerAgentId),
        ),
      )
      .limit(1)

    return row ?? null
  }

  async listAllForCompany(ctx: Ctx, companyId: string, tx?: Tx): Promise<Agent[]> {
    const executor = this.getExecutor(tx)
    return executor
      .select()
      .from(agents)
      .where(and(eq(agents.orgId, ctx.orgId), eq(agents.companyId, companyId)))
      .orderBy(agents.name)
  }

  async countActiveSubordinates(ctx: Ctx, agentId: string, tx?: Tx): Promise<number> {
    const executor = this.getExecutor(tx)
    const [res] = await executor
      .select({ value: count() })
      .from(agents)
      .where(
        and(
          eq(agents.orgId, ctx.orgId),
          eq(agents.managerAgentId, agentId),
          ne(agents.status, 'retired'),
        ),
      )

    return Number(res?.value ?? 0)
  }

  async list(
    ctx: Ctx,
    filter?: AgentFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<Agent>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(agents.orgId, ctx.orgId)]

    if (filter?.companyId) {
      conditions.push(eq(agents.companyId, filter.companyId))
    }

    if (filter?.departmentId !== undefined) {
      if (filter.departmentId === null) {
        conditions.push(isNull(agents.departmentId))
      } else {
        conditions.push(eq(agents.departmentId, filter.departmentId))
      }
    }

    if (filter?.managerAgentId !== undefined) {
      if (filter.managerAgentId === null) {
        conditions.push(isNull(agents.managerAgentId))
      } else {
        conditions.push(eq(agents.managerAgentId, filter.managerAgentId))
      }
    }

    if (filter?.status) {
      conditions.push(eq(agents.status, filter.status))
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${agents.createdAt}, ${agents.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(agents)
      .where(and(...conditions))
      .orderBy(desc(agents.createdAt), desc(agents.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }

  async create(ctx: Ctx, input: CreateAgentInput, tx?: Tx): Promise<Agent> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()

    const [row] = await executor
      .insert(agents)
      .values({
        id,
        orgId: ctx.orgId,
        companyId: input.companyId,
        departmentId: input.departmentId ?? null,
        managerAgentId: input.managerAgentId ?? null,
        name: input.name,
        role: input.role,
        title: input.title,
        systemPrompt: input.systemPrompt,
        systemPromptVersion: input.systemPromptVersion ?? 1,
        maxAutonomyLevel: input.maxAutonomyLevel ?? 1,
        monthlyBudgetUsd: input.monthlyBudgetUsd ?? '10.000000',
        status: input.status ?? 'active',
        avatarUrl: input.avatarUrl ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create agent')
    }

    return row
  }

  async update(ctx: Ctx, id: string, patch: UpdateAgentInput, tx?: Tx): Promise<Agent> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()

    const updateData: Partial<typeof agents.$inferInsert> = {
      updatedAt: now,
    }

    if (patch.departmentId !== undefined) updateData.departmentId = patch.departmentId
    if (patch.managerAgentId !== undefined) updateData.managerAgentId = patch.managerAgentId
    if (patch.name !== undefined) updateData.name = patch.name
    if (patch.role !== undefined) updateData.role = patch.role
    if (patch.title !== undefined) updateData.title = patch.title
    if (patch.systemPrompt !== undefined) updateData.systemPrompt = patch.systemPrompt
    if (patch.systemPromptVersion !== undefined) updateData.systemPromptVersion = patch.systemPromptVersion
    if (patch.maxAutonomyLevel !== undefined) updateData.maxAutonomyLevel = patch.maxAutonomyLevel
    if (patch.monthlyBudgetUsd !== undefined) updateData.monthlyBudgetUsd = patch.monthlyBudgetUsd
    if (patch.status !== undefined) updateData.status = patch.status
    if (patch.avatarUrl !== undefined) updateData.avatarUrl = patch.avatarUrl

    const [row] = await executor
      .update(agents)
      .set(updateData)
      .where(and(eq(agents.orgId, ctx.orgId), eq(agents.id, id)))
      .returning()

    if (!row) {
      throw notFound('Agent', id)
    }

    return row
  }
}

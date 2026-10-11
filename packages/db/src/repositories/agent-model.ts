import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import {
  notFound,
  encodeCursor,
  decodeCursor,
  paginationQuerySchema,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { agentModels, type AgentModel } from '../schema/agent-links.js'
import type { Ctx, DbOrTx } from './types.js'

export interface AgentModelFilter {
  agentId?: string
  role?: 'preferred' | 'fallback'
}

export interface CreateAgentModelInput {
  agentId: string
  modelId: string
  role: 'preferred' | 'fallback'
  priority?: number
  temperature?: string | null
  maxOutputTokens?: number | null
}

export interface UpdateAgentModelInput {
  role?: 'preferred' | 'fallback'
  priority?: number
  temperature?: string | null
  maxOutputTokens?: number | null
}

export class AgentModelRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async findById(ctx: Ctx, id: string, tx?: Tx): Promise<AgentModel | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(agentModels)
      .where(and(eq(agentModels.orgId, ctx.orgId), eq(agentModels.id, id)))
      .limit(1)

    return row ?? null
  }

  async findByIdOrThrow(ctx: Ctx, id: string, tx?: Tx): Promise<AgentModel> {
    const row = await this.findById(ctx, id, tx)
    if (!row) {
      throw notFound('AgentModel', id)
    }
    return row
  }

  async listByAgentIds(ctx: Ctx, agentIds: string[], tx?: Tx): Promise<AgentModel[]> {
    if (agentIds.length === 0) return []
    const executor = this.getExecutor(tx)
    return executor
      .select()
      .from(agentModels)
      .where(and(eq(agentModels.orgId, ctx.orgId), inArray(agentModels.agentId, agentIds)))
      .orderBy(agentModels.role, agentModels.priority)
  }

  async deleteByAgentId(ctx: Ctx, agentId: string, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    await executor
      .delete(agentModels)
      .where(and(eq(agentModels.orgId, ctx.orgId), eq(agentModels.agentId, agentId)))
  }

  async list(
    ctx: Ctx,
    filter?: AgentModelFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<AgentModel>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(agentModels.orgId, ctx.orgId)]

    if (filter?.agentId) {
      conditions.push(eq(agentModels.agentId, filter.agentId))
    }

    if (filter?.role) {
      conditions.push(eq(agentModels.role, filter.role))
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${agentModels.createdAt}, ${agentModels.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(agentModels)
      .where(and(...conditions))
      .orderBy(desc(agentModels.createdAt), desc(agentModels.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }

  async create(ctx: Ctx, input: CreateAgentModelInput, tx?: Tx): Promise<AgentModel> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()

    const [row] = await executor
      .insert(agentModels)
      .values({
        id,
        orgId: ctx.orgId,
        agentId: input.agentId,
        modelId: input.modelId,
        role: input.role,
        priority: input.priority ?? 0,
        temperature: input.temperature ?? null,
        maxOutputTokens: input.maxOutputTokens ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create agent model assignment')
    }

    return row
  }

  async update(ctx: Ctx, id: string, patch: UpdateAgentModelInput, tx?: Tx): Promise<AgentModel> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()

    const updateData: Partial<typeof agentModels.$inferInsert> = {
      updatedAt: now,
    }

    if (patch.role !== undefined) updateData.role = patch.role
    if (patch.priority !== undefined) updateData.priority = patch.priority
    if (patch.temperature !== undefined) updateData.temperature = patch.temperature
    if (patch.maxOutputTokens !== undefined) updateData.maxOutputTokens = patch.maxOutputTokens

    const [row] = await executor
      .update(agentModels)
      .set(updateData)
      .where(and(eq(agentModels.orgId, ctx.orgId), eq(agentModels.id, id)))
      .returning()

    if (!row) {
      throw notFound('AgentModel', id)
    }

    return row
  }
}

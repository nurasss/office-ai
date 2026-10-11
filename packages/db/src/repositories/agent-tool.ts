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
import { agentTools, type AgentTool } from '../schema/agent-links.js'
import type { Ctx, DbOrTx } from './types.js'

export interface AgentToolFilter {
  agentId?: string
  enabled?: boolean
}

export interface CreateAgentToolInput {
  agentId: string
  toolId: string
  scopes?: string[]
  enabled?: boolean
}

export interface UpdateAgentToolInput {
  scopes?: string[]
  enabled?: boolean
}

export class AgentToolRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async findById(ctx: Ctx, id: string, tx?: Tx): Promise<AgentTool | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(agentTools)
      .where(and(eq(agentTools.orgId, ctx.orgId), eq(agentTools.id, id)))
      .limit(1)

    return row ?? null
  }

  async findByIdOrThrow(ctx: Ctx, id: string, tx?: Tx): Promise<AgentTool> {
    const row = await this.findById(ctx, id, tx)
    if (!row) {
      throw notFound('AgentTool', id)
    }
    return row
  }

  async listByAgentIds(ctx: Ctx, agentIds: string[], tx?: Tx): Promise<AgentTool[]> {
    if (agentIds.length === 0) return []
    const executor = this.getExecutor(tx)
    return executor
      .select()
      .from(agentTools)
      .where(and(eq(agentTools.orgId, ctx.orgId), inArray(agentTools.agentId, agentIds)))
  }

  async deleteByAgentId(ctx: Ctx, agentId: string, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    await executor
      .delete(agentTools)
      .where(and(eq(agentTools.orgId, ctx.orgId), eq(agentTools.agentId, agentId)))
  }

  async list(
    ctx: Ctx,
    filter?: AgentToolFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<AgentTool>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(agentTools.orgId, ctx.orgId)]

    if (filter?.agentId) {
      conditions.push(eq(agentTools.agentId, filter.agentId))
    }

    if (filter?.enabled !== undefined) {
      conditions.push(eq(agentTools.enabled, filter.enabled))
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${agentTools.createdAt}, ${agentTools.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(agentTools)
      .where(and(...conditions))
      .orderBy(desc(agentTools.createdAt), desc(agentTools.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }

  async create(ctx: Ctx, input: CreateAgentToolInput, tx?: Tx): Promise<AgentTool> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()

    const [row] = await executor
      .insert(agentTools)
      .values({
        id,
        orgId: ctx.orgId,
        agentId: input.agentId,
        toolId: input.toolId,
        scopes: input.scopes ?? [],
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create agent tool assignment')
    }

    return row
  }

  async update(ctx: Ctx, id: string, patch: UpdateAgentToolInput, tx?: Tx): Promise<AgentTool> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()

    const updateData: Partial<typeof agentTools.$inferInsert> = {
      updatedAt: now,
    }

    if (patch.scopes !== undefined) updateData.scopes = patch.scopes
    if (patch.enabled !== undefined) updateData.enabled = patch.enabled

    const [row] = await executor
      .update(agentTools)
      .set(updateData)
      .where(and(eq(agentTools.orgId, ctx.orgId), eq(agentTools.id, id)))
      .returning()

    if (!row) {
      throw notFound('AgentTool', id)
    }

    return row
  }
}

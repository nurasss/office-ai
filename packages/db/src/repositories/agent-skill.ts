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
import { agentSkills, type AgentSkill } from '../schema/agent-links.js'
import type { Ctx, DbOrTx } from './types.js'

export interface AgentSkillFilter {
  agentId?: string
}

export interface CreateAgentSkillInput {
  agentId: string
  skillId: string
  level?: 'basic' | 'proficient' | 'expert'
}

export interface UpdateAgentSkillInput {
  level?: 'basic' | 'proficient' | 'expert'
}

export class AgentSkillRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async findById(ctx: Ctx, id: string, tx?: Tx): Promise<AgentSkill | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.orgId, ctx.orgId), eq(agentSkills.id, id)))
      .limit(1)

    return row ?? null
  }

  async findByIdOrThrow(ctx: Ctx, id: string, tx?: Tx): Promise<AgentSkill> {
    const row = await this.findById(ctx, id, tx)
    if (!row) {
      throw notFound('AgentSkill', id)
    }
    return row
  }

  async listByAgentIds(ctx: Ctx, agentIds: string[], tx?: Tx): Promise<AgentSkill[]> {
    if (agentIds.length === 0) return []
    const executor = this.getExecutor(tx)
    return executor
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.orgId, ctx.orgId), inArray(agentSkills.agentId, agentIds)))
  }

  async deleteByAgentId(ctx: Ctx, agentId: string, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    await executor
      .delete(agentSkills)
      .where(and(eq(agentSkills.orgId, ctx.orgId), eq(agentSkills.agentId, agentId)))
  }

  async list(
    ctx: Ctx,
    filter?: AgentSkillFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<AgentSkill>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(agentSkills.orgId, ctx.orgId)]

    if (filter?.agentId) {
      conditions.push(eq(agentSkills.agentId, filter.agentId))
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${agentSkills.createdAt}, ${agentSkills.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(agentSkills)
      .where(and(...conditions))
      .orderBy(desc(agentSkills.createdAt), desc(agentSkills.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }

  async create(ctx: Ctx, input: CreateAgentSkillInput, tx?: Tx): Promise<AgentSkill> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()

    const [row] = await executor
      .insert(agentSkills)
      .values({
        id,
        orgId: ctx.orgId,
        agentId: input.agentId,
        skillId: input.skillId,
        level: input.level ?? 'proficient',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create agent skill assignment')
    }

    return row
  }

  async update(ctx: Ctx, id: string, patch: UpdateAgentSkillInput, tx?: Tx): Promise<AgentSkill> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()

    const updateData: Partial<typeof agentSkills.$inferInsert> = {
      updatedAt: now,
    }

    if (patch.level !== undefined) updateData.level = patch.level

    const [row] = await executor
      .update(agentSkills)
      .set(updateData)
      .where(and(eq(agentSkills.orgId, ctx.orgId), eq(agentSkills.id, id)))
      .returning()

    if (!row) {
      throw notFound('AgentSkill', id)
    }

    return row
  }
}

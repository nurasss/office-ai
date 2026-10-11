import { eq, and, desc, gte, lte, sql } from 'drizzle-orm'
import {
  encodeCursor,
  decodeCursor,
  paginationQuerySchema,
  Usd,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { modelInvocations, type ModelInvocation } from '../schema/invocations.js'
import type { Ctx, DbOrTx } from './types.js'

export interface ModelInvocationFilter {
  companyId?: string | undefined
  agentId?: string | undefined
  provider?: string | undefined
  modelKey?: string | undefined
  status?: ('success' | 'error') | undefined
  errorKind?: string | undefined
  fromCreatedAt?: Date | undefined
  toCreatedAt?: Date | undefined
}

export interface ModelInvocationPeriodFilter {
  companyId?: string | undefined
  agentId?: string | undefined
  fromCreatedAt: Date
  toCreatedAt: Date
}

export interface CreateModelInvocationInput {
  companyId?: string | null | undefined
  agentId?: string | null | undefined
  provider: string
  modelKey: string
  modelId?: string | null | undefined
  requestId: string
  attempt?: number | undefined
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  cachedInputTokens?: number | undefined
  costUsd?: string | Usd | undefined
  latencyMs?: number | undefined
  status: 'success' | 'error'
  stopReason?: string | null | undefined
  errorKind?: string | null | undefined
}

export class ModelInvocationRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  /**
   * Appends an immutable model invocation record scoped to the organization.
   */
  async append(
    ctx: Ctx,
    entry: CreateModelInvocationInput,
    tx?: Tx,
  ): Promise<ModelInvocation> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()
    const costStr =
      typeof entry.costUsd === 'string'
        ? entry.costUsd
        : entry.costUsd !== undefined
          ? entry.costUsd.toString()
          : '0.000000'

    const [row] = await executor
      .insert(modelInvocations)
      .values({
        id,
        orgId: ctx.orgId,
        companyId: entry.companyId ?? null,
        agentId: entry.agentId ?? null,
        provider: entry.provider,
        modelKey: entry.modelKey,
        modelId: entry.modelId ?? null,
        requestId: entry.requestId,
        attempt: entry.attempt ?? 1,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        cachedInputTokens: entry.cachedInputTokens ?? 0,
        costUsd: costStr,
        latencyMs: entry.latencyMs ?? 0,
        status: entry.status,
        stopReason: entry.stopReason ?? null,
        errorKind: entry.errorKind ?? null,
        createdAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to insert model invocation')
    }

    return row
  }

  async list(
    ctx: Ctx,
    filter?: ModelInvocationFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<ModelInvocation>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(modelInvocations.orgId, ctx.orgId)]

    if (filter?.companyId) {
      conditions.push(eq(modelInvocations.companyId, filter.companyId))
    }
    if (filter?.agentId) {
      conditions.push(eq(modelInvocations.agentId, filter.agentId))
    }
    if (filter?.provider) {
      conditions.push(eq(modelInvocations.provider, filter.provider))
    }
    if (filter?.modelKey) {
      conditions.push(eq(modelInvocations.modelKey, filter.modelKey))
    }
    if (filter?.status) {
      conditions.push(eq(modelInvocations.status, filter.status))
    }
    if (filter?.errorKind) {
      conditions.push(eq(modelInvocations.errorKind, filter.errorKind))
    }
    if (filter?.fromCreatedAt) {
      conditions.push(gte(modelInvocations.createdAt, filter.fromCreatedAt))
    }
    if (filter?.toCreatedAt) {
      conditions.push(lte(modelInvocations.createdAt, filter.toCreatedAt))
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${modelInvocations.createdAt}, ${modelInvocations.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(modelInvocations)
      .where(and(...conditions))
      .orderBy(desc(modelInvocations.createdAt), desc(modelInvocations.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }

  async sumCostForPeriod(
    ctx: Ctx,
    filter: ModelInvocationPeriodFilter,
    tx?: Tx,
  ): Promise<Usd> {
    const executor = this.getExecutor(tx)
    const conditions = [
      eq(modelInvocations.orgId, ctx.orgId),
      gte(modelInvocations.createdAt, filter.fromCreatedAt),
      lte(modelInvocations.createdAt, filter.toCreatedAt),
    ]

    if (filter.companyId) {
      conditions.push(eq(modelInvocations.companyId, filter.companyId))
    }
    if (filter.agentId) {
      conditions.push(eq(modelInvocations.agentId, filter.agentId))
    }

    const result = await executor
      .select({
        totalCost: sql<string>`coalesce(sum(${modelInvocations.costUsd}), '0.000000')`,
      })
      .from(modelInvocations)
      .where(and(...conditions))

    const totalStr = result[0]?.totalCost ?? '0.000000'
    return Usd.fromString(totalStr)
  }
}

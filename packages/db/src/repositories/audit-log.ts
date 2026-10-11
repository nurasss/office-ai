import { eq, and, desc, sql } from 'drizzle-orm'
import {
  encodeCursor,
  decodeCursor,
  paginationQuerySchema,
  type Page,
  type PaginationQuery,
  type Clock,
  type IdGenerator,
} from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { auditLogs, type AuditLog } from '../schema/security.js'
import type { Ctx, DbOrTx } from './types.js'

export interface AuditLogFilter {
  actorType?: ('user' | 'agent' | 'system') | undefined
  actorId?: string | undefined
  action?: string | undefined
  resourceType?: string | undefined
  resourceId?: string | undefined
}

export interface CreateAuditLogInput {
  actorType: 'user' | 'agent' | 'system'
  actorId?: string | null | undefined
  action: string
  resourceType: string
  resourceId?: string | null | undefined
  metadata?: Record<string, unknown> | undefined
  ip?: string | null | undefined
  userAgent?: string | null | undefined
}

export interface PlatformAuditLogInput extends CreateAuditLogInput {
  clock: Clock
  ids: IdGenerator
}

export class AuditLogRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  /**
   * Appends an immutable audit log entry scoped to a tenant organization.
   * Note: Audit logs are append-only. No update or delete operations are permitted.
   */
  async append(ctx: Ctx, entry: CreateAuditLogInput, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()

    await executor.insert(auditLogs).values({
      id,
      orgId: ctx.orgId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      createdAt: now,
    })
  }

  /**
   * Appends an immutable platform-level audit log entry (org_id = null).
   * Used for platform-wide events like authentication, login failures, token revocations.
   */
  async appendPlatform(entry: PlatformAuditLogInput, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    const now = entry.clock.now()
    const id = entry.ids.next()

    await executor.insert(auditLogs).values({
      id,
      orgId: null,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      createdAt: now,
    })
  }

  async list(
    ctx: Ctx,
    filter?: AuditLogFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<AuditLog>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(auditLogs.orgId, ctx.orgId)]

    if (filter?.actorType) {
      conditions.push(eq(auditLogs.actorType, filter.actorType))
    }
    if (filter?.actorId) {
      conditions.push(eq(auditLogs.actorId, filter.actorId))
    }
    if (filter?.action) {
      conditions.push(eq(auditLogs.action, filter.action))
    }
    if (filter?.resourceType) {
      conditions.push(eq(auditLogs.resourceType, filter.resourceType))
    }
    if (filter?.resourceId) {
      conditions.push(eq(auditLogs.resourceId, filter.resourceId))
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }
}

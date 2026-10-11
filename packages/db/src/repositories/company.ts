import { eq, and, desc, sql } from 'drizzle-orm'
import {
  notFound,
  encodeCursor,
  decodeCursor,
  paginationQuerySchema,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { companies, type Company } from '../schema/company.js'
import type { Ctx, DbOrTx } from './types.js'

export interface CompanyFilter {
  status?: ('active' | 'paused' | 'archived') | undefined
}

export interface CreateCompanyInput {
  name: string
  slug: string
  description?: string | null | undefined
  mission?: string | null | undefined
  mode?: ('assistant' | 'copilot' | 'autonomous') | undefined
  monthlyBudgetUsd?: string | undefined
  settings?: Record<string, unknown> | undefined
  status?: ('active' | 'paused' | 'archived') | undefined
}

export interface UpdateCompanyInput {
  name?: string | undefined
  slug?: string | undefined
  description?: string | null | undefined
  mission?: string | null | undefined
  mode?: ('assistant' | 'copilot' | 'autonomous') | undefined
  monthlyBudgetUsd?: string | undefined
  settings?: Record<string, unknown> | undefined
  status?: ('active' | 'paused' | 'archived') | undefined
}

export class CompanyRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async findById(ctx: Ctx, id: string, tx?: Tx): Promise<Company | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(companies)
      .where(and(eq(companies.orgId, ctx.orgId), eq(companies.id, id)))
      .limit(1)

    return row ?? null
  }

  async findByIdOrThrow(ctx: Ctx, id: string, tx?: Tx): Promise<Company> {
    const row = await this.findById(ctx, id, tx)
    if (!row) {
      throw notFound('Company', id)
    }
    return row
  }

  async findBySlug(ctx: Ctx, slug: string, tx?: Tx): Promise<Company | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(companies)
      .where(and(eq(companies.orgId, ctx.orgId), eq(companies.slug, slug)))
      .limit(1)

    return row ?? null
  }

  async list(
    ctx: Ctx,
    filter?: CompanyFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<Company>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(companies.orgId, ctx.orgId)]

    if (filter?.status) {
      conditions.push(eq(companies.status, filter.status))
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${companies.createdAt}, ${companies.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(companies)
      .where(and(...conditions))
      .orderBy(desc(companies.createdAt), desc(companies.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }

  async create(ctx: Ctx, input: CreateCompanyInput, tx?: Tx): Promise<Company> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()

    const [row] = await executor
      .insert(companies)
      .values({
        id,
        orgId: ctx.orgId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        mission: input.mission ?? null,
        mode: input.mode ?? 'copilot',
        monthlyBudgetUsd: input.monthlyBudgetUsd ?? '50.000000',
        settings: input.settings ?? {},
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create company')
    }

    return row
  }

  async update(ctx: Ctx, id: string, patch: UpdateCompanyInput, tx?: Tx): Promise<Company> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()

    const updateData: Partial<typeof companies.$inferInsert> = {
      updatedAt: now,
    }

    if (patch.name !== undefined) updateData.name = patch.name
    if (patch.slug !== undefined) updateData.slug = patch.slug
    if (patch.description !== undefined) updateData.description = patch.description
    if (patch.mission !== undefined) updateData.mission = patch.mission
    if (patch.mode !== undefined) updateData.mode = patch.mode
    if (patch.monthlyBudgetUsd !== undefined) updateData.monthlyBudgetUsd = patch.monthlyBudgetUsd
    if (patch.settings !== undefined) updateData.settings = patch.settings
    if (patch.status !== undefined) updateData.status = patch.status

    const [row] = await executor
      .update(companies)
      .set(updateData)
      .where(and(eq(companies.orgId, ctx.orgId), eq(companies.id, id)))
      .returning()

    if (!row) {
      throw notFound('Company', id)
    }

    return row
  }
}

import { eq, and, desc, sql, isNull, count } from 'drizzle-orm'
import {
  notFound,
  encodeCursor,
  decodeCursor,
  paginationQuerySchema,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { departments, agents, type Department } from '../schema/company.js'
import type { Ctx, DbOrTx } from './types.js'

export interface DepartmentFilter {
  companyId?: string | undefined
  parentDepartmentId?: string | null | undefined
}

export interface CreateDepartmentInput {
  companyId: string
  parentDepartmentId?: string | null | undefined
  name: string
  code: string
  monthlyBudgetUsd?: string | null | undefined
}

export interface UpdateDepartmentInput {
  parentDepartmentId?: string | null | undefined
  name?: string | undefined
  code?: string | undefined
  monthlyBudgetUsd?: string | null | undefined
}

export class DepartmentRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async findById(ctx: Ctx, id: string, tx?: Tx): Promise<Department | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(departments)
      .where(and(eq(departments.orgId, ctx.orgId), eq(departments.id, id)))
      .limit(1)

    return row ?? null
  }

  async findByIdOrThrow(ctx: Ctx, id: string, tx?: Tx): Promise<Department> {
    const row = await this.findById(ctx, id, tx)
    if (!row) {
      throw notFound('Department', id)
    }
    return row
  }

  async findByCode(
    ctx: Ctx,
    companyId: string,
    code: string,
    tx?: Tx,
  ): Promise<Department | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.orgId, ctx.orgId),
          eq(departments.companyId, companyId),
          eq(departments.code, code),
        ),
      )
      .limit(1)

    return row ?? null
  }

  async listAllForCompany(ctx: Ctx, companyId: string, tx?: Tx): Promise<Department[]> {
    const executor = this.getExecutor(tx)
    return executor
      .select()
      .from(departments)
      .where(and(eq(departments.orgId, ctx.orgId), eq(departments.companyId, companyId)))
      .orderBy(departments.name)
  }

  async countAgentsByDepartment(ctx: Ctx, departmentId: string, tx?: Tx): Promise<number> {
    const executor = this.getExecutor(tx)
    const [res] = await executor
      .select({ value: count() })
      .from(agents)
      .where(and(eq(agents.orgId, ctx.orgId), eq(agents.departmentId, departmentId)))

    return Number(res?.value ?? 0)
  }

  async countChildDepartments(ctx: Ctx, departmentId: string, tx?: Tx): Promise<number> {
    const executor = this.getExecutor(tx)
    const [res] = await executor
      .select({ value: count() })
      .from(departments)
      .where(and(eq(departments.orgId, ctx.orgId), eq(departments.parentDepartmentId, departmentId)))

    return Number(res?.value ?? 0)
  }

  async list(
    ctx: Ctx,
    filter?: DepartmentFilter,
    page?: PaginationQuery,
    tx?: Tx,
  ): Promise<Page<Department>> {
    const executor = this.getExecutor(tx)
    const pagination = paginationQuerySchema.parse(page ?? {})
    const conditions = [eq(departments.orgId, ctx.orgId)]

    if (filter?.companyId) {
      conditions.push(eq(departments.companyId, filter.companyId))
    }

    if (filter?.parentDepartmentId !== undefined) {
      if (filter.parentDepartmentId === null) {
        conditions.push(isNull(departments.parentDepartmentId))
      } else {
        conditions.push(eq(departments.parentDepartmentId, filter.parentDepartmentId))
      }
    }

    if (pagination.cursor) {
      const cursor = decodeCursor(pagination.cursor)
      conditions.push(
        sql`(${departments.createdAt}, ${departments.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await executor
      .select()
      .from(departments)
      .where(and(...conditions))
      .orderBy(desc(departments.createdAt), desc(departments.id))
      .limit(pagination.limit + 1)

    const hasMore = rows.length > pagination.limit
    const items = hasMore ? rows.slice(0, pagination.limit) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return { items, nextCursor }
  }

  async create(ctx: Ctx, input: CreateDepartmentInput, tx?: Tx): Promise<Department> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()
    const id = ctx.ids.next()

    const [row] = await executor
      .insert(departments)
      .values({
        id,
        orgId: ctx.orgId,
        companyId: input.companyId,
        parentDepartmentId: input.parentDepartmentId ?? null,
        name: input.name,
        code: input.code,
        monthlyBudgetUsd: input.monthlyBudgetUsd ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create department')
    }

    return row
  }

  async update(ctx: Ctx, id: string, patch: UpdateDepartmentInput, tx?: Tx): Promise<Department> {
    const executor = this.getExecutor(tx)
    const now = ctx.clock.now()

    const updateData: Partial<typeof departments.$inferInsert> = {
      updatedAt: now,
    }

    if (patch.parentDepartmentId !== undefined) updateData.parentDepartmentId = patch.parentDepartmentId
    if (patch.name !== undefined) updateData.name = patch.name
    if (patch.code !== undefined) updateData.code = patch.code
    if (patch.monthlyBudgetUsd !== undefined) updateData.monthlyBudgetUsd = patch.monthlyBudgetUsd

    const [row] = await executor
      .update(departments)
      .set(updateData)
      .where(and(eq(departments.orgId, ctx.orgId), eq(departments.id, id)))
      .returning()

    if (!row) {
      throw notFound('Department', id)
    }

    return row
  }

  async delete(ctx: Ctx, id: string, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    const res = await executor
      .delete(departments)
      .where(and(eq(departments.orgId, ctx.orgId), eq(departments.id, id)))
      .returning({ id: departments.id })

    if (res.length === 0) {
      throw notFound('Department', id)
    }
  }
}

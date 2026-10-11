import {
  conflict,
  validationError,
  AppError,
  ERROR_CODES,
  type RequestContext,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import type { Department } from '@ai-company/db'
import type { AppDeps } from '../deps.js'

export interface CreateDepartmentServiceInput {
  companyId: string
  parentDepartmentId?: string | null | undefined
  name: string
  code: string
  monthlyBudgetUsd?: string | null | undefined
}

export interface UpdateDepartmentServiceInput {
  parentDepartmentId?: string | null | undefined
  name?: string | undefined
  code?: string | undefined
  monthlyBudgetUsd?: string | null | undefined
}

export interface DepartmentServiceFilter {
  companyId?: string | undefined
  parentDepartmentId?: string | null | undefined
}

export class DepartmentService {
  constructor(private readonly deps: AppDeps) {}

  private computeDepth(deptId: string, deptsMap: Map<string, Department>): number {
    let depth = 1
    let curr = deptsMap.get(deptId)
    const visited = new Set<string>([deptId])

    while (curr?.parentDepartmentId) {
      if (visited.has(curr.parentDepartmentId)) {
        break // Cycle
      }
      visited.add(curr.parentDepartmentId)
      curr = deptsMap.get(curr.parentDepartmentId)
      depth++
    }

    return depth
  }

  private computeMaxSubtreeDepth(deptId: string, allDepts: Department[]): number {
    const childrenMap = new Map<string, string[]>()
    for (const d of allDepts) {
      if (d.parentDepartmentId) {
        const list = childrenMap.get(d.parentDepartmentId) ?? []
        list.push(d.id)
        childrenMap.set(d.parentDepartmentId, list)
      }
    }

    function getSubtreeDepth(id: string): number {
      const children = childrenMap.get(id) ?? []
      if (children.length === 0) return 1
      let maxChild = 0
      for (const childId of children) {
        maxChild = Math.max(maxChild, getSubtreeDepth(childId))
      }
      return 1 + maxChild
    }

    return getSubtreeDepth(deptId)
  }

  async create(ctx: RequestContext, input: CreateDepartmentServiceInput): Promise<Department> {
    // 1. Verify company exists
    await this.deps.repos.companies.findByIdOrThrow(ctx, input.companyId)

    // 2. Check code uniqueness within company
    const normalizedCode = input.code.trim().toUpperCase()
    const existingCode = await this.deps.repos.departments.findByCode(
      ctx,
      input.companyId,
      normalizedCode,
    )
    if (existingCode) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        `Department code '${normalizedCode}' already exists in company`,
        { code: normalizedCode },
      )
    }

    // 3. Check parent department if specified
    if (input.parentDepartmentId) {
      const parent = await this.deps.repos.departments.findById(ctx, input.parentDepartmentId)
      if (!parent || parent.companyId !== input.companyId) {
        throw validationError([
          {
            code: 'custom',
            path: ['parentDepartmentId'],
            message: 'Parent department does not exist or belongs to a different company',
          },
        ])
      }

      const allDepts = await this.deps.repos.departments.listAllForCompany(ctx, input.companyId)
      const deptsMap = new Map(allDepts.map((d) => [d.id, d]))
      const parentDepth = this.computeDepth(input.parentDepartmentId, deptsMap)

      if (parentDepth + 1 > 5) {
        throw validationError([
          {
            code: 'custom',
            path: ['parentDepartmentId'],
            message: 'Department nesting depth cannot exceed 5 levels',
          },
        ])
      }
    }

    const dept = await this.deps.repos.departments.create(ctx, {
      companyId: input.companyId,
      parentDepartmentId: input.parentDepartmentId ?? null,
      name: input.name.trim(),
      code: normalizedCode,
      monthlyBudgetUsd: input.monthlyBudgetUsd ?? null,
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'department.create',
        resourceType: 'department',
        resourceId: dept.id,
        metadata: {
          name: dept.name,
          code: dept.code,
          companyId: dept.companyId,
          parentDepartmentId: dept.parentDepartmentId,
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for department.create', err })
    }

    return dept
  }

  async list(
    ctx: RequestContext,
    filter?: DepartmentServiceFilter,
    page?: PaginationQuery,
  ): Promise<Page<Department>> {
    return this.deps.repos.departments.list(ctx, filter, page)
  }

  async get(ctx: RequestContext, id: string): Promise<Department> {
    return this.deps.repos.departments.findByIdOrThrow(ctx, id)
  }

  async update(
    ctx: RequestContext,
    id: string,
    patch: UpdateDepartmentServiceInput,
  ): Promise<Department> {
    const dept = await this.deps.repos.departments.findByIdOrThrow(ctx, id)

    // Check code uniqueness if changing code
    let normalizedCode: string | undefined
    if (patch.code !== undefined) {
      normalizedCode = patch.code.trim().toUpperCase()
      if (normalizedCode !== dept.code) {
        const existing = await this.deps.repos.departments.findByCode(
          ctx,
          dept.companyId,
          normalizedCode,
        )
        if (existing && existing.id !== id) {
          throw conflict(
            ERROR_CODES.CONFLICT,
            `Department code '${normalizedCode}' already exists in company`,
            { code: normalizedCode },
          )
        }
      }
    }

    // Check parent cycle and depth if updating parentDepartmentId
    if (patch.parentDepartmentId !== undefined) {
      if (patch.parentDepartmentId === id) {
        throw new AppError({
          code: 'DEPARTMENT_CYCLE',
          httpStatus: 409,
          message: 'Department cannot be its own parent',
        })
      }

      if (patch.parentDepartmentId !== null) {
        const parent = await this.deps.repos.departments.findById(ctx, patch.parentDepartmentId)
        if (!parent || parent.companyId !== dept.companyId) {
          throw validationError([
            {
              code: 'custom',
              path: ['parentDepartmentId'],
              message: 'Parent department does not exist or belongs to a different company',
            },
          ])
        }

        const allDepts = await this.deps.repos.departments.listAllForCompany(ctx, dept.companyId)
        const deptsMap = new Map(allDepts.map((d) => [d.id, d]))

        // TODO(concurrency): проверка цикла не атомарна, нужен SELECT ... FOR UPDATE по агентам компании внутри транзакции
        // Check cycle: walk up from patch.parentDepartmentId to see if we reach id
        let curr: Department | undefined = parent
        const visited = new Set<string>()

        while (curr) {
          if (curr.id === id) {
            throw new AppError({
              code: 'DEPARTMENT_CYCLE',
              httpStatus: 409,
              message: 'Cycle detected: new parent department is a descendant of this department',
            })
          }
          if (visited.has(curr.id)) {
            break
          }
          visited.add(curr.id)
          curr = curr.parentDepartmentId ? deptsMap.get(curr.parentDepartmentId) : undefined
        }

        // Check depth: parentDepth + subtreeDepth of id <= 5
        const parentDepth = this.computeDepth(patch.parentDepartmentId, deptsMap)
        const subtreeDepth = this.computeMaxSubtreeDepth(id, allDepts)

        if (parentDepth + subtreeDepth > 5) {
          throw validationError([
            {
              code: 'custom',
              path: ['parentDepartmentId'],
              message: 'Department nesting depth cannot exceed 5 levels',
            },
          ])
        }
      }
    }

    const updated = await this.deps.repos.departments.update(ctx, id, {
      parentDepartmentId: patch.parentDepartmentId,
      name: patch.name !== undefined ? patch.name.trim() : undefined,
      code: normalizedCode,
      monthlyBudgetUsd: patch.monthlyBudgetUsd,
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'department.update',
        resourceType: 'department',
        resourceId: id,
        metadata: {
          updatedFields: Object.keys(patch),
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for department.update', err })
    }

    return updated
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.deps.repos.departments.findByIdOrThrow(ctx, id)

    // Check assigned agents
    const agentCount = await this.deps.repos.departments.countAgentsByDepartment(ctx, id)
    if (agentCount > 0) {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        httpStatus: 409,
        message: 'Cannot delete department with assigned agents',
        details: { agentCount },
      })
    }

    // Check child departments
    const childCount = await this.deps.repos.departments.countChildDepartments(ctx, id)
    if (childCount > 0) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Cannot delete department with child departments',
        { childCount },
      )
    }

    await this.deps.repos.departments.delete(ctx, id)

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'department.delete',
        resourceType: 'department',
        resourceId: id,
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for department.delete', err })
    }
  }
}

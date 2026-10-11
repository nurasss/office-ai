import {
  conflict,
  ERROR_CODES,
  type RequestContext,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import type { Company } from '@ai-company/db'
import type { AppDeps } from '../deps.js'
import { slugify } from './auth-service.js'

export interface CreateCompanyServiceInput {
  name: string
  description?: string | null | undefined
  mission?: string | null | undefined
  mode?: ('assistant' | 'copilot' | 'autonomous') | undefined
  monthlyBudgetUsd?: string | undefined
  settings?: Record<string, unknown> | undefined
}

export interface UpdateCompanyServiceInput {
  name?: string | undefined
  description?: string | null | undefined
  mission?: string | null | undefined
  mode?: ('assistant' | 'copilot' | 'autonomous') | undefined
  monthlyBudgetUsd?: string | undefined
  settings?: Record<string, unknown> | undefined
  status?: ('active' | 'paused' | 'archived') | undefined
}

export interface OrgChartDepartment {
  id: string
  name: string
  code: string
  monthlyBudgetUsd: string | null
  parentDepartmentId: string | null
  children: OrgChartDepartment[]
  agents: OrgChartAgent[]
}

export interface OrgChartAgent {
  id: string
  name: string
  role: string
  title: string
  departmentId: string | null
  managerAgentId: string | null
  status: string
}

export interface OrgChart {
  company: Company
  departments: OrgChartDepartment[]
  unassignedAgents: OrgChartAgent[]
}

export class CompanyService {
  constructor(private readonly deps: AppDeps) {}

  async create(ctx: RequestContext, input: CreateCompanyServiceInput): Promise<Company> {
    const baseSlug = slugify(input.name)
    let chosenSlug: string | null = null

    for (let attempt = 1; attempt <= 50; attempt++) {
      const candidateSlug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`
      const existing = await this.deps.repos.companies.findBySlug(ctx, candidateSlug)
      if (!existing) {
        chosenSlug = candidateSlug
        break
      }
    }

    if (!chosenSlug) {
      throw conflict(
        ERROR_CODES.SLUG_ALREADY_EXISTS,
        'Failed to generate unique company slug after 50 attempts',
        { name: input.name },
      )
    }

    const company = await this.deps.repos.companies.create(ctx, {
      name: input.name.trim(),
      slug: chosenSlug,
      description: input.description ?? null,
      mission: input.mission ?? null,
      mode: input.mode ?? 'copilot',
      monthlyBudgetUsd: input.monthlyBudgetUsd ?? '50.000000',
      settings: input.settings ?? {},
      status: 'active',
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'company.create',
        resourceType: 'company',
        resourceId: company.id,
        metadata: { name: company.name, slug: company.slug },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for company.create', err })
    }

    return company
  }

  async list(
    ctx: RequestContext,
    filter?: { status?: ('active' | 'paused' | 'archived') | undefined },
    page?: PaginationQuery,
  ): Promise<Page<Company>> {
    return this.deps.repos.companies.list(ctx, filter, page)
  }

  async get(ctx: RequestContext, id: string): Promise<Company> {
    return this.deps.repos.companies.findByIdOrThrow(ctx, id)
  }

  async update(
    ctx: RequestContext,
    id: string,
    patch: UpdateCompanyServiceInput,
  ): Promise<Company> {
    const existing = await this.deps.repos.companies.findByIdOrThrow(ctx, id)

    const updated = await this.deps.repos.companies.update(ctx, id, {
      name: patch.name !== undefined ? patch.name.trim() : undefined,
      description: patch.description,
      mission: patch.mission,
      mode: patch.mode,
      monthlyBudgetUsd: patch.monthlyBudgetUsd,
      settings: patch.settings,
      status: patch.status,
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'company.update',
        resourceType: 'company',
        resourceId: id,
        metadata: {
          previousName: existing.name,
          updatedFields: Object.keys(patch),
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for company.update', err })
    }

    return updated
  }

  async archive(ctx: RequestContext, id: string): Promise<Company> {
    const updated = await this.deps.repos.companies.update(ctx, id, { status: 'archived' })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'company.archive',
        resourceType: 'company',
        resourceId: id,
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for company.archive', err })
    }

    return updated
  }

  async getOrgChart(ctx: RequestContext, companyId: string): Promise<OrgChart> {
    const company = await this.deps.repos.companies.findByIdOrThrow(ctx, companyId)

    // Single query for all departments of company
    const allDepartments = await this.deps.repos.departments.listAllForCompany(ctx, companyId)

    // Single query for all agents of company
    const allAgents = await this.deps.repos.agents.listAllForCompany(ctx, companyId)

    // Group agents by departmentId
    const agentsByDept = new Map<string, OrgChartAgent[]>()
    const unassignedAgents: OrgChartAgent[] = []

    for (const a of allAgents) {
      const chartAgent: OrgChartAgent = {
        id: a.id,
        name: a.name,
        role: a.role,
        title: a.title,
        departmentId: a.departmentId,
        managerAgentId: a.managerAgentId,
        status: a.status,
      }

      if (!a.departmentId) {
        unassignedAgents.push(chartAgent)
      } else {
        const list = agentsByDept.get(a.departmentId) ?? []
        list.push(chartAgent)
        agentsByDept.set(a.departmentId, list)
      }
    }

    // Build department tree
    const deptsByParent = new Map<string | null, typeof allDepartments>()
    for (const d of allDepartments) {
      const parentId = d.parentDepartmentId
      const list = deptsByParent.get(parentId) ?? []
      list.push(d)
      deptsByParent.set(parentId, list)
    }

    function buildDeptNode(dept: (typeof allDepartments)[0]): OrgChartDepartment {
      const childRows = deptsByParent.get(dept.id) ?? []
      const children = childRows.map(buildDeptNode)
      const deptAgents = agentsByDept.get(dept.id) ?? []

      return {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        monthlyBudgetUsd: dept.monthlyBudgetUsd,
        parentDepartmentId: dept.parentDepartmentId,
        children,
        agents: deptAgents,
      }
    }

    const rootDeptRows = deptsByParent.get(null) ?? []
    const rootDepartments = rootDeptRows.map(buildDeptNode)

    return {
      company,
      departments: rootDepartments,
      unassignedAgents,
    }
  }
}

import {
  conflict,
  validationError,
  AppError,
  ERROR_CODES,
  requiresApproval,
  isToolAssignable,
  type RequestContext,
  type Page,
  type PaginationQuery,
} from '@ai-company/shared'
import { withTransaction, type Agent } from '@ai-company/db'
import type { AppDeps } from '../deps.js'

export interface AgentViewTool {
  key: string
  scopes: string[]
  autonomyLevel: number
  requiresApproval: boolean
}

export interface AgentViewModelPolicy {
  preferred: string
  fallback: string[]
}

export interface AgentView {
  id: string
  name: string
  role: string
  title: string
  departmentId: string | null
  managerId: string | null
  modelPolicy: AgentViewModelPolicy
  skills: string[]
  tools: AgentViewTool[]
  maxAutonomyLevel: number
  monthlyBudgetUsd: string
  status: 'draft' | 'active' | 'paused' | 'retired'
  avatarUrl?: string | null | undefined
}

export interface CreateAgentServiceInput {
  companyId: string
  departmentId?: string | null | undefined
  managerId?: string | null | undefined
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

export interface UpdateAgentServiceInput {
  departmentId?: string | null | undefined
  managerId?: string | null | undefined
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

export interface SetAgentModelsInputItem {
  modelKey: string
  role: 'preferred' | 'fallback'
  priority?: number | undefined
  temperature?: string | null | undefined
  maxOutputTokens?: number | null | undefined
}

export interface SetAgentToolsInputItem {
  toolKey: string
  scopes?: string[] | undefined
  enabled?: boolean | undefined
}

export interface SetAgentSkillsInputItem {
  skillKey: string
  level?: ('basic' | 'proficient' | 'expert') | undefined
}

export interface AgentServiceFilter {
  companyId?: string | undefined
  departmentId?: string | null | undefined
  status?: ('draft' | 'active' | 'paused' | 'retired') | undefined
  managerId?: string | null | undefined
}

export class AgentService {
  constructor(private readonly deps: AppDeps) {}

  private computeDepth(agentId: string, agentsMap: Map<string, Agent>): number {
    let depth = 1
    let curr = agentsMap.get(agentId)
    const visited = new Set<string>([agentId])

    while (curr?.managerAgentId) {
      if (visited.has(curr.managerAgentId)) {
        break
      }
      visited.add(curr.managerAgentId)
      curr = agentsMap.get(curr.managerAgentId)
      depth++
    }

    return depth
  }

  private computeMaxSubtreeDepth(agentId: string, allAgents: Agent[]): number {
    const subordinatesMap = new Map<string, string[]>()
    for (const a of allAgents) {
      if (a.managerAgentId) {
        const list = subordinatesMap.get(a.managerAgentId) ?? []
        list.push(a.id)
        subordinatesMap.set(a.managerAgentId, list)
      }
    }

    function getSubtreeDepth(id: string): number {
      const subs = subordinatesMap.get(id) ?? []
      if (subs.length === 0) return 1
      let maxChild = 0
      for (const subId of subs) {
        maxChild = Math.max(maxChild, getSubtreeDepth(subId))
      }
      return 1 + maxChild
    }

    return getSubtreeDepth(agentId)
  }

  async create(ctx: RequestContext, input: CreateAgentServiceInput): Promise<AgentView> {
    // 1. Verify company exists
    await this.deps.repos.companies.findByIdOrThrow(ctx, input.companyId)

    // 2. Verify name uniqueness within company
    const normalizedName = input.name.trim()
    const existingName = await this.deps.repos.agents.findByName(
      ctx,
      input.companyId,
      normalizedName,
    )
    if (existingName) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        `Agent with name '${normalizedName}' already exists in company`,
        { name: normalizedName },
      )
    }

    // 3. Manager and CEO validation
    if (!input.managerId) {
      const existingCeo = await this.deps.repos.agents.findCeo(ctx, input.companyId)
      if (existingCeo) {
        throw conflict(
          ERROR_CODES.CONFLICT,
          'Company already has a CEO agent with no manager (FR-2.1 hierarchy root)',
          { ceoAgentId: existingCeo.id },
        )
      }
    } else {
      const manager = await this.deps.repos.agents.findById(ctx, input.managerId)
      if (!manager || manager.companyId !== input.companyId) {
        throw validationError([
          {
            code: 'custom',
            path: ['managerId'],
            message: 'Manager agent does not exist or belongs to a different company',
          },
        ])
      }

      const allAgents = await this.deps.repos.agents.listAllForCompany(ctx, input.companyId)
      const agentsMap = new Map(allAgents.map((a) => [a.id, a]))
      const managerDepth = this.computeDepth(input.managerId, agentsMap)

      if (managerDepth + 1 > 4) {
        throw validationError([
          {
            code: 'custom',
            path: ['managerId'],
            message: 'Agent manager chain cannot exceed 4 levels',
          },
        ])
      }
    }

    // 4. Department validation if specified
    if (input.departmentId) {
      const dept = await this.deps.repos.departments.findById(ctx, input.departmentId)
      if (!dept || dept.companyId !== input.companyId) {
        throw validationError([
          {
            code: 'custom',
            path: ['departmentId'],
            message: 'Department does not exist or belongs to a different company',
          },
        ])
      }
    }

    const agent = await this.deps.repos.agents.create(ctx, {
      companyId: input.companyId,
      departmentId: input.departmentId ?? null,
      managerAgentId: input.managerId ?? null,
      name: normalizedName,
      role: input.role.trim(),
      title: input.title.trim(),
      systemPrompt: input.systemPrompt,
      systemPromptVersion: input.systemPromptVersion ?? 1,
      maxAutonomyLevel: input.maxAutonomyLevel ?? 1,
      monthlyBudgetUsd: input.monthlyBudgetUsd ?? '10.000000',
      status: input.status ?? 'active',
      avatarUrl: input.avatarUrl ?? null,
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.create',
        resourceType: 'agent',
        resourceId: agent.id,
        metadata: {
          name: agent.name,
          role: agent.role,
          companyId: agent.companyId,
          managerAgentId: agent.managerAgentId,
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.create', err })
    }

    return this.get(ctx, agent.id)
  }

  async get(ctx: RequestContext, id: string): Promise<AgentView> {
    const agent = await this.deps.repos.agents.findByIdOrThrow(ctx, id)
    const views = await this.buildAgentViews(ctx, [agent])
    const view = views[0]
    if (!view) {
      throw conflict(ERROR_CODES.INTERNAL_ERROR, 'Failed to build agent view')
    }
    return view
  }

  async list(
    ctx: RequestContext,
    filter?: AgentServiceFilter,
    page?: PaginationQuery,
  ): Promise<Page<AgentView>> {
    const agentsPage = await this.deps.repos.agents.list(
      ctx,
      {
        companyId: filter?.companyId,
        departmentId: filter?.departmentId,
        status: filter?.status,
        managerAgentId: filter?.managerId,
      },
      page,
    )

    if (agentsPage.items.length === 0) {
      return { items: [], nextCursor: null }
    }

    const views = await this.buildAgentViews(ctx, agentsPage.items)
    return {
      items: views,
      nextCursor: agentsPage.nextCursor,
    }
  }

  private async buildAgentViews(ctx: RequestContext, agentRows: Agent[]): Promise<AgentView[]> {
    if (agentRows.length === 0) return []
    const agentIds = agentRows.map((a) => a.id)

    // Batch load models, tools, and skills across all agent IDs (no N+1 queries)
    const [allAgentModels, allAgentTools, allAgentSkills] = await Promise.all([
      this.deps.repos.agentModels.listByAgentIds(ctx, agentIds),
      this.deps.repos.agentTools.listByAgentIds(ctx, agentIds),
      this.deps.repos.agentSkills.listByAgentIds(ctx, agentIds),
    ])

    // Collect all model, tool, and skill catalog IDs
    const modelIds = Array.from(new Set(allAgentModels.map((m) => m.modelId)))
    const toolIds = Array.from(new Set(allAgentTools.map((t) => t.toolId)))
    const skillIds = Array.from(new Set(allAgentSkills.map((s) => s.skillId)))

    const [catalogModels, catalogTools, catalogSkills] = await Promise.all([
      this.deps.repos.catalog.findModelsByIds(modelIds),
      this.deps.repos.catalog.findToolsByIds(toolIds),
      this.deps.repos.catalog.findSkillsByIds(skillIds),
    ])

    const modelMap = new Map(catalogModels.map((m) => [m.id, m]))
    const toolMap = new Map(catalogTools.map((t) => [t.id, t]))
    const skillMap = new Map(catalogSkills.map((s) => [s.id, s]))

    // Group links by agentId
    const modelsByAgent = new Map<string, typeof allAgentModels>()
    for (const m of allAgentModels) {
      const list = modelsByAgent.get(m.agentId) ?? []
      list.push(m)
      modelsByAgent.set(m.agentId, list)
    }

    const toolsByAgent = new Map<string, typeof allAgentTools>()
    for (const t of allAgentTools) {
      const list = toolsByAgent.get(t.agentId) ?? []
      list.push(t)
      toolsByAgent.set(t.agentId, list)
    }

    const skillsByAgent = new Map<string, typeof allAgentSkills>()
    for (const s of allAgentSkills) {
      const list = skillsByAgent.get(s.agentId) ?? []
      list.push(s)
      skillsByAgent.set(s.agentId, list)
    }

    return agentRows.map((agent) => {
      const agentModelLinks = modelsByAgent.get(agent.id) ?? []
      let preferred = ''
      const fallback: string[] = []

      for (const m of agentModelLinks) {
        const catModel = modelMap.get(m.modelId)
        const key = catModel ? catModel.modelKey : m.modelId
        if (m.role === 'preferred') {
          preferred = key
        } else {
          fallback.push(key)
        }
      }

      const agentToolLinks = toolsByAgent.get(agent.id) ?? []
      const tools: AgentViewTool[] = []
      for (const tl of agentToolLinks) {
        const catTool = toolMap.get(tl.toolId)
        if (catTool) {
          tools.push({
            key: catTool.key,
            scopes: tl.scopes ?? [],
            autonomyLevel: catTool.autonomyLevel,
            requiresApproval: requiresApproval(catTool.autonomyLevel, agent.maxAutonomyLevel),
          })
        }
      }

      const agentSkillLinks = skillsByAgent.get(agent.id) ?? []
      const skills: string[] = []
      for (const sl of agentSkillLinks) {
        const catSkill = skillMap.get(sl.skillId)
        if (catSkill) {
          skills.push(catSkill.key)
        }
      }

      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        title: agent.title,
        departmentId: agent.departmentId,
        managerId: agent.managerAgentId,
        modelPolicy: {
          preferred,
          fallback,
        },
        skills,
        tools,
        maxAutonomyLevel: agent.maxAutonomyLevel,
        monthlyBudgetUsd: agent.monthlyBudgetUsd,
        status: agent.status,
        avatarUrl: agent.avatarUrl,
      }
    })
  }

  async update(ctx: RequestContext, id: string, patch: UpdateAgentServiceInput): Promise<AgentView> {
    const agent = await this.deps.repos.agents.findByIdOrThrow(ctx, id)

    // Name uniqueness
    let normalizedName: string | undefined
    if (patch.name !== undefined) {
      normalizedName = patch.name.trim()
      if (normalizedName !== agent.name) {
        const existing = await this.deps.repos.agents.findByName(
          ctx,
          agent.companyId,
          normalizedName,
        )
        if (existing && existing.id !== id) {
          throw conflict(
            ERROR_CODES.CONFLICT,
            `Agent with name '${normalizedName}' already exists in company`,
            { name: normalizedName },
          )
        }
      }
    }

    // Manager / CEO changes
    if (patch.managerId !== undefined) {
      if (patch.managerId === null && agent.managerAgentId !== null) {
        // Turning into CEO
        const existingCeo = await this.deps.repos.agents.findCeo(ctx, agent.companyId)
        if (existingCeo && existingCeo.id !== id) {
          throw conflict(
            ERROR_CODES.CONFLICT,
            'Company already has a CEO agent with no manager',
            { ceoAgentId: existingCeo.id },
          )
        }
      }

      if (patch.managerId !== null) {
        if (patch.managerId === id) {
          throw new AppError({
            code: 'AGENT_CYCLE',
            httpStatus: 409,
            message: 'Agent cannot be their own manager',
          })
        }

        const manager = await this.deps.repos.agents.findById(ctx, patch.managerId)
        if (!manager || manager.companyId !== agent.companyId) {
          throw validationError([
            {
              code: 'custom',
              path: ['managerId'],
              message: 'Manager agent does not exist or belongs to a different company',
            },
          ])
        }

        const allAgents = await this.deps.repos.agents.listAllForCompany(ctx, agent.companyId)
        const agentsMap = new Map(allAgents.map((a) => [a.id, a]))

        // TODO(concurrency): проверка цикла не атомарна, нужен SELECT ... FOR UPDATE по агентам компании внутри транзакции
        // Check cycle: walk up from patch.managerId
        let curr: Agent | undefined = manager
        const visited = new Set<string>()

        while (curr) {
          if (curr.id === id) {
            throw new AppError({
              code: 'AGENT_CYCLE',
              httpStatus: 409,
              message: 'Cycle detected in agent manager hierarchy',
            })
          }
          if (visited.has(curr.id)) {
            break
          }
          visited.add(curr.id)
          curr = curr.managerAgentId ? agentsMap.get(curr.managerAgentId) : undefined
        }

        // Depth check: managerDepth + subtreeDepth <= 4
        const managerDepth = this.computeDepth(patch.managerId, agentsMap)
        const subtreeDepth = this.computeMaxSubtreeDepth(id, allAgents)

        if (managerDepth + subtreeDepth > 4) {
          throw validationError([
            {
              code: 'custom',
              path: ['managerId'],
              message: 'Agent manager chain cannot exceed 4 levels',
            },
          ])
        }
      }
    }

    // Department validation
    if (patch.departmentId !== undefined && patch.departmentId !== null) {
      const dept = await this.deps.repos.departments.findById(ctx, patch.departmentId)
      if (!dept || dept.companyId !== agent.companyId) {
        throw validationError([
          {
            code: 'custom',
            path: ['departmentId'],
            message: 'Department does not exist or belongs to a different company',
          },
        ])
      }
    }

    // Autonomy level reduction check:
    // If lowering maxAutonomyLevel below 3, verify no Level 3 tools are assigned
    if (patch.maxAutonomyLevel !== undefined && patch.maxAutonomyLevel < 3 && agent.maxAutonomyLevel >= 3) {
      const assignedTools = await this.deps.repos.agentTools.listByAgentIds(ctx, [id])
      const toolIds = assignedTools.map((t) => t.toolId)
      const catalogTools = await this.deps.repos.catalog.findToolsByIds(toolIds)

      const hasLevel3 = catalogTools.some((t) => t.autonomyLevel === 3)
      if (hasLevel3) {
        throw conflict(
          ERROR_CODES.CONFLICT,
          'Cannot decrease maxAutonomyLevel below 3 while Level 3 critical tools are assigned. Remove Level 3 tools first.',
        )
      }
    }

    await this.deps.repos.agents.update(ctx, id, {
      departmentId: patch.departmentId,
      managerAgentId: patch.managerId,
      name: normalizedName,
      role: patch.role !== undefined ? patch.role.trim() : undefined,
      title: patch.title !== undefined ? patch.title.trim() : undefined,
      systemPrompt: patch.systemPrompt,
      systemPromptVersion: patch.systemPromptVersion,
      maxAutonomyLevel: patch.maxAutonomyLevel,
      monthlyBudgetUsd: patch.monthlyBudgetUsd,
      status: patch.status,
      avatarUrl: patch.avatarUrl,
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.update',
        resourceType: 'agent',
        resourceId: id,
        metadata: {
          updatedFields: Object.keys(patch),
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.update', err })
    }

    return this.get(ctx, id)
  }

  async pause(ctx: RequestContext, id: string): Promise<AgentView> {
    await this.deps.repos.agents.update(ctx, id, { status: 'paused' })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.pause',
        resourceType: 'agent',
        resourceId: id,
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.pause', err })
    }

    return this.get(ctx, id)
  }

  async activate(ctx: RequestContext, id: string): Promise<AgentView> {
    await this.deps.repos.agents.update(ctx, id, { status: 'active' })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.activate',
        resourceType: 'agent',
        resourceId: id,
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.activate', err })
    }

    return this.get(ctx, id)
  }

  async retire(ctx: RequestContext, id: string): Promise<AgentView> {
    await this.deps.repos.agents.findByIdOrThrow(ctx, id)

    // Check active subordinates
    const activeSubordinates = await this.deps.repos.agents.countActiveSubordinates(ctx, id)
    if (activeSubordinates > 0) {
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Cannot retire agent with active subordinates. Reassign subordinates first.',
        { activeSubordinates },
      )
    }

    await this.deps.repos.agents.update(ctx, id, { status: 'retired' })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.retire',
        resourceType: 'agent',
        resourceId: id,
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.retire', err })
    }

    return this.get(ctx, id)
  }

  async setModels(
    ctx: RequestContext,
    id: string,
    modelsInput: SetAgentModelsInputItem[],
  ): Promise<AgentView> {
    const agent = await this.deps.repos.agents.findByIdOrThrow(ctx, id)

    // Validate preferred and fallback counts
    const preferredModels = modelsInput.filter((m) => m.role === 'preferred')
    const fallbackModels = modelsInput.filter((m) => m.role === 'fallback')

    if (preferredModels.length === 0) {
      throw validationError([
        {
          code: 'custom',
          path: ['models'],
          message: 'Agent must have exactly one preferred model (found 0)',
        },
      ])
    }

    if (preferredModels.length > 1) {
      throw validationError([
        {
          code: 'custom',
          path: ['models'],
          message: `Agent must have exactly one preferred model (found ${preferredModels.length})`,
        },
      ])
    }

    if (fallbackModels.length === 0) {
      throw validationError([
        {
          code: 'custom',
          path: ['models'],
          message: 'Agent must have at least one fallback model (FR-4.2 requirement)',
        },
      ])
    }

    // Resolve models from catalog and check deprecated status
    const resolvedModels: Array<{
      modelId: string
      role: 'preferred' | 'fallback'
      priority: number
      temperature: string | null
      maxOutputTokens: number | null
    }> = []

    for (const item of modelsInput) {
      const catModel = await this.deps.repos.catalog.findModelByModelKey(item.modelKey)
      if (!catModel) {
        throw validationError([
          {
            code: 'custom',
            path: ['models'],
            message: `Model '${item.modelKey}' not found in catalog`,
          },
        ])
      }

      if (catModel.status === 'deprecated') {
        throw validationError([
          {
            code: 'custom',
            path: ['models'],
            message: `Cannot assign deprecated model '${item.modelKey}'`,
          },
        ])
      }

      resolvedModels.push({
        modelId: catModel.id,
        role: item.role,
        priority: item.priority ?? 0,
        temperature: item.temperature ?? null,
        maxOutputTokens: item.maxOutputTokens ?? null,
      })
    }

    // Atomic full replacement
    await withTransaction(this.deps.db, async (tx) => {
      await this.deps.repos.agentModels.deleteByAgentId(ctx, agent.id, tx)
      for (const m of resolvedModels) {
        await this.deps.repos.agentModels.create(
          ctx,
          {
            agentId: agent.id,
            modelId: m.modelId,
            role: m.role,
            priority: m.priority,
            temperature: m.temperature,
            maxOutputTokens: m.maxOutputTokens,
          },
          tx,
        )
      }
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.models_updated',
        resourceType: 'agent',
        resourceId: id,
        metadata: {
          modelCount: modelsInput.length,
          preferred: preferredModels[0]?.modelKey,
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.models_updated', err })
    }

    return this.get(ctx, id)
  }

  async setTools(
    ctx: RequestContext,
    id: string,
    toolsInput: SetAgentToolsInputItem[],
  ): Promise<AgentView> {
    const agent = await this.deps.repos.agents.findByIdOrThrow(ctx, id)

    const resolvedTools: Array<{
      toolId: string
      scopes: string[]
      enabled: boolean
    }> = []

    for (const item of toolsInput) {
      const catTool = await this.deps.repos.catalog.findToolByKey(item.toolKey)
      if (!catTool) {
        throw validationError([
          {
            code: 'custom',
            path: ['tools'],
            message: `Tool '${item.toolKey}' not found in catalog`,
          },
        ])
      }

      if (!isToolAssignable(catTool.autonomyLevel, agent.maxAutonomyLevel)) {
        throw validationError([
          {
            code: 'custom',
            path: ['tools'],
            message: `Tool '${catTool.key}' with autonomy level ${catTool.autonomyLevel} cannot be assigned to agent with maxAutonomyLevel ${agent.maxAutonomyLevel}. Raise agent maxAutonomyLevel to 3 first.`,
          },
        ])
      }

      resolvedTools.push({
        toolId: catTool.id,
        scopes: item.scopes ?? [],
        enabled: item.enabled ?? true,
      })
    }

    // Atomic full replacement
    await withTransaction(this.deps.db, async (tx) => {
      await this.deps.repos.agentTools.deleteByAgentId(ctx, agent.id, tx)
      for (const t of resolvedTools) {
        await this.deps.repos.agentTools.create(
          ctx,
          {
            agentId: agent.id,
            toolId: t.toolId,
            scopes: t.scopes,
            enabled: t.enabled,
          },
          tx,
        )
      }
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.tools_updated',
        resourceType: 'agent',
        resourceId: id,
        metadata: {
          toolCount: toolsInput.length,
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.tools_updated', err })
    }

    return this.get(ctx, id)
  }

  async setSkills(
    ctx: RequestContext,
    id: string,
    skillsInput: SetAgentSkillsInputItem[],
  ): Promise<AgentView> {
    const agent = await this.deps.repos.agents.findByIdOrThrow(ctx, id)

    const resolvedSkills: Array<{
      skillId: string
      level: 'basic' | 'proficient' | 'expert'
    }> = []

    for (const item of skillsInput) {
      const catSkill = await this.deps.repos.catalog.findSkillByKey(item.skillKey)
      if (!catSkill) {
        throw validationError([
          {
            code: 'custom',
            path: ['skills'],
            message: `Skill '${item.skillKey}' not found in catalog`,
          },
        ])
      }

      resolvedSkills.push({
        skillId: catSkill.id,
        level: item.level ?? 'proficient',
      })
    }

    // Atomic full replacement
    await withTransaction(this.deps.db, async (tx) => {
      await this.deps.repos.agentSkills.deleteByAgentId(ctx, agent.id, tx)
      for (const s of resolvedSkills) {
        await this.deps.repos.agentSkills.create(
          ctx,
          {
            agentId: agent.id,
            skillId: s.skillId,
            level: s.level,
          },
          tx,
        )
      }
    })

    try {
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.skills_updated',
        resourceType: 'agent',
        resourceId: id,
        metadata: {
          skillCount: skillsInput.length,
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for agent.skills_updated', err })
    }

    return this.get(ctx, id)
  }
}

import { hashPassword } from '@ai-company/shared'
import type { Database } from '../client.js'
import { users } from '../schema/auth.js'
import { organizations, organizationMembers } from '../schema/org.js'
import { companies, departments, agents } from '../schema/company.js'
import { models, tools, skills } from '../schema/catalog.js'
import { agentModels, agentTools, agentSkills } from '../schema/agent-links.js'

export const DEMO_ORG_ID = '01918361-b4f7-7890-8000-000000000001'
export const DEMO_COMPANY_ID = '01918361-b4f7-7890-8000-000000000002'

export const DEMO_USER_ID = '01918361-b4f7-7890-9000-000000000001'
export const DEMO_USER_EMAIL = 'demo@example.com'
export const DEMO_USER_PASSWORD = 'demo-password-12345'
export const DEMO_USER_NAME = 'Demo User'

export const DEMO_DEPARTMENTS = [
  {
    id: '01918361-b4f7-7890-8000-000000000010',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    name: 'Executive Office',
    code: 'EXEC',
    monthlyBudgetUsd: '20.000000',
  },
  {
    id: '01918361-b4f7-7890-8000-000000000011',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    name: 'Research & Strategy',
    code: 'RES',
    monthlyBudgetUsd: '10.000000',
  },
  {
    id: '01918361-b4f7-7890-8000-000000000012',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    name: 'Engineering',
    code: 'ENG',
    monthlyBudgetUsd: '15.000000',
  },
  {
    id: '01918361-b4f7-7890-8000-000000000013',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    name: 'Data Analytics',
    code: 'DATA',
    monthlyBudgetUsd: '5.000000',
  },
]

export const DEMO_AGENTS = [
  {
    id: '01918361-b4f7-7890-8000-000000000020',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    departmentId: '01918361-b4f7-7890-8000-000000000010',
    managerAgentId: null,
    name: 'CEO',
    role: 'Chief Executive Officer',
    title: 'Executive Leader',
    systemPrompt:
      'You are the Chief Executive Officer of Acme AI. You define corporate strategy, delegate objectives to department leaders, and evaluate high-level business performance. You coordinate autonomous agent workflows and provide managerial guidance. You do not write or deploy production code directly.',
    systemPromptVersion: 1,
    maxAutonomyLevel: 1,
    monthlyBudgetUsd: '20.000000',
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-8000-000000000021',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    departmentId: '01918361-b4f7-7890-8000-000000000011',
    managerAgentId: '01918361-b4f7-7890-8000-000000000020',
    name: 'Researcher',
    role: 'Lead Market & Technical Researcher',
    title: 'Research Analyst',
    systemPrompt:
      'You are the Lead Research Agent. You synthesize information from web sources, internal documents, and marketplace trends into actionable reports. You operate strictly in read-only analysis mode and provide structured insights to executive and engineering teams. You never execute write operations on external systems.',
    systemPromptVersion: 1,
    maxAutonomyLevel: 0,
    monthlyBudgetUsd: '10.000000',
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-8000-000000000022',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    departmentId: '01918361-b4f7-7890-8000-000000000012',
    managerAgentId: '01918361-b4f7-7890-8000-000000000020',
    name: 'Developer',
    role: 'Senior Full-Stack Engineer',
    title: 'Software Engineer',
    systemPrompt:
      'You are the Senior Software Engineer. You design, implement, and test full-stack TypeScript solutions following repository architecture standards. You create branches, modify local files, and submit pull requests for peer review. You ensure high code quality, typing discipline, and rigorous unit test coverage.',
    systemPromptVersion: 1,
    maxAutonomyLevel: 1,
    monthlyBudgetUsd: '15.000000',
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-8000-000000000023',
    orgId: DEMO_ORG_ID,
    companyId: DEMO_COMPANY_ID,
    departmentId: '01918361-b4f7-7890-8000-000000000013',
    managerAgentId: '01918361-b4f7-7890-8000-000000000020',
    name: 'Analyst',
    role: 'Quantitative & Operations Analyst',
    title: 'Data Analyst',
    systemPrompt:
      'You are the Quantitative Data Analyst. You inspect telemetry metrics, financial ledgers, and database query logs to generate analytical summaries. You execute read-only queries and never alter database state. You produce structured charts and tables for strategic decision making.',
    systemPromptVersion: 1,
    maxAutonomyLevel: 0,
    monthlyBudgetUsd: '5.000000',
    status: 'active' as const,
  },
]

export async function seedDemoCompany(db: Database): Promise<void> {
  // 0. Demo User
  const passwordHash = await hashPassword(DEMO_USER_PASSWORD)
  await db
    .insert(users)
    .values({
      id: DEMO_USER_ID,
      email: DEMO_USER_EMAIL,
      passwordHash,
      name: DEMO_USER_NAME,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: DEMO_USER_EMAIL,
        passwordHash,
        name: DEMO_USER_NAME,
        status: 'active',
        updatedAt: new Date(),
      },
    })

  // 1. Organization
  await db
    .insert(organizations)
    .values({
      id: DEMO_ORG_ID,
      name: 'Demo Org',
      slug: 'demo-org',
      plan: 'pro',
      monthlyBudgetUsd: '100.000000',
      status: 'active',
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: {
        name: 'Demo Org',
        slug: 'demo-org',
        plan: 'pro',
        monthlyBudgetUsd: '100.000000',
        status: 'active',
        updatedAt: new Date(),
      },
    })

  // 1b. Organization Membership for Demo User
  await db
    .insert(organizationMembers)
    .values({
      id: '01918361-b4f7-7890-9000-000000000010',
      orgId: DEMO_ORG_ID,
      userId: DEMO_USER_ID,
      role: 'owner',
    })
    .onConflictDoUpdate({
      target: [organizationMembers.orgId, organizationMembers.userId],
      set: {
        role: 'owner',
        updatedAt: new Date(),
      },
    })

  // 2. Company
  await db
    .insert(companies)
    .values({
      id: DEMO_COMPANY_ID,
      orgId: DEMO_ORG_ID,
      name: 'Acme AI',
      slug: 'acme-ai',
      description: 'Autonomous enterprise workspace demo company',
      mission: 'Build and operate a fully autonomous AI software company',
      mode: 'copilot',
      status: 'active',
      monthlyBudgetUsd: '50.000000',
      settings: { timezone: 'UTC', defaultLanguage: 'en' },
    })
    .onConflictDoUpdate({
      target: companies.id,
      set: {
        name: 'Acme AI',
        slug: 'acme-ai',
        description: 'Autonomous enterprise workspace demo company',
        mission: 'Build and operate a fully autonomous AI software company',
        mode: 'copilot',
        status: 'active',
        monthlyBudgetUsd: '50.000000',
        settings: { timezone: 'UTC', defaultLanguage: 'en' },
        updatedAt: new Date(),
      },
    })

  // 3. Departments
  for (const dept of DEMO_DEPARTMENTS) {
    await db
      .insert(departments)
      .values(dept)
      .onConflictDoUpdate({
        target: departments.id,
        set: {
          name: dept.name,
          code: dept.code,
          monthlyBudgetUsd: dept.monthlyBudgetUsd,
          updatedAt: new Date(),
        },
      })
  }

  // 4. Agents
  for (const agent of DEMO_AGENTS) {
    await db
      .insert(agents)
      .values(agent)
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          departmentId: agent.departmentId,
          managerAgentId: agent.managerAgentId,
          name: agent.name,
          role: agent.role,
          title: agent.title,
          systemPrompt: agent.systemPrompt,
          systemPromptVersion: agent.systemPromptVersion,
          maxAutonomyLevel: agent.maxAutonomyLevel,
          monthlyBudgetUsd: agent.monthlyBudgetUsd,
          status: agent.status,
          updatedAt: new Date(),
        },
      })
  }

  // Fetch catalog maps for ID lookups
  const allModels = await db.select().from(models)
  const allTools = await db.select().from(tools)
  const allSkills = await db.select().from(skills)

  const modelMap = new Map(allModels.map((m) => [m.modelKey, m.id]))
  const toolMap = new Map(allTools.map((t) => [t.key, t.id]))
  const skillMap = new Map(allSkills.map((s) => [s.key, s.id]))

  // 5. Agent Models (preferred + fallback for each agent)
  const agentModelAssignments: {
    agentId: string
    modelKey: string
    role: 'preferred' | 'fallback'
    priority: number
    temperature: string
  }[] = [
    // CEO: frontier preferred (claude-opus-5), fallback (VERIFY-openai-frontier)
    {
      agentId: '01918361-b4f7-7890-8000-000000000020',
      modelKey: 'claude-opus-5',
      role: 'preferred',
      priority: 0,
      temperature: '0.70',
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000020',
      modelKey: 'VERIFY-openai-frontier',
      role: 'fallback',
      priority: 1,
      temperature: '0.70',
    },
    // Researcher: cheap large-context preferred (VERIFY-google-cheap), fallback (claude-haiku-4-5-20251001)
    {
      agentId: '01918361-b4f7-7890-8000-000000000021',
      modelKey: 'VERIFY-google-cheap',
      role: 'preferred',
      priority: 0,
      temperature: '0.30',
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000021',
      modelKey: 'claude-haiku-4-5-20251001',
      role: 'fallback',
      priority: 1,
      temperature: '0.30',
    },
    // Developer: Claude-class preferred (claude-sonnet-5), fallback (VERIFY-openai-frontier)
    {
      agentId: '01918361-b4f7-7890-8000-000000000022',
      modelKey: 'claude-sonnet-5',
      role: 'preferred',
      priority: 0,
      temperature: '0.20',
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000022',
      modelKey: 'VERIFY-openai-frontier',
      role: 'fallback',
      priority: 1,
      temperature: '0.20',
    },
    // Analyst: cheap preferred (claude-haiku-4-5-20251001), fallback (VERIFY-google-cheap)
    {
      agentId: '01918361-b4f7-7890-8000-000000000023',
      modelKey: 'claude-haiku-4-5-20251001',
      role: 'preferred',
      priority: 0,
      temperature: '0.10',
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000023',
      modelKey: 'VERIFY-google-cheap',
      role: 'fallback',
      priority: 1,
      temperature: '0.10',
    },
  ]

  for (let i = 0; i < agentModelAssignments.length; i++) {
    const item = agentModelAssignments[i]!
    const modelId = modelMap.get(item.modelKey)
    if (!modelId) throw new Error(`Model not found in catalog: ${item.modelKey}`)

    const seq = String(i + 1).padStart(12, '0')
    await db
      .insert(agentModels)
      .values({
        id: `01918361-b4f7-7890-d000-${seq}`,
        orgId: DEMO_ORG_ID,
        agentId: item.agentId,
        modelId,
        role: item.role,
        priority: item.priority,
        temperature: item.temperature,
      })
      .onConflictDoUpdate({
        target: [agentModels.agentId, agentModels.modelId],
        set: {
          role: item.role,
          priority: item.priority,
          temperature: item.temperature,
          updatedAt: new Date(),
        },
      })
  }

  // 6. Agent Tools
  const agentToolAssignments: {
    agentId: string
    toolKey: string
    scopes: string[]
    enabled: boolean
  }[] = [
    // CEO: task_create, web_search
    {
      agentId: '01918361-b4f7-7890-8000-000000000020',
      toolKey: 'task_create',
      scopes: ['tasks.create', 'tasks.assign'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000020',
      toolKey: 'web_search',
      scopes: ['search.read'],
      enabled: true,
    },
    // Researcher: web_search, web_fetch, knowledge_search
    {
      agentId: '01918361-b4f7-7890-8000-000000000021',
      toolKey: 'web_search',
      scopes: ['search.read'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000021',
      toolKey: 'web_fetch',
      scopes: ['fetch.read'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000021',
      toolKey: 'knowledge_search',
      scopes: ['knowledge.read'],
      enabled: true,
    },
    // Developer: github_repo_read, github_branch_create, file_read, file_write, github_pr_create (level 2 with approval)
    {
      agentId: '01918361-b4f7-7890-8000-000000000022',
      toolKey: 'github_repo_read',
      scopes: ['repo.read'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000022',
      toolKey: 'github_branch_create',
      scopes: ['branch.create'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000022',
      toolKey: 'file_read',
      scopes: ['file.read'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000022',
      toolKey: 'file_write',
      scopes: ['file.write'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000022',
      toolKey: 'github_pr_create',
      scopes: ['pr.create'],
      enabled: true,
    },
    // Analyst: db_query_readonly, file_read
    {
      agentId: '01918361-b4f7-7890-8000-000000000023',
      toolKey: 'db_query_readonly',
      scopes: ['db.read'],
      enabled: true,
    },
    {
      agentId: '01918361-b4f7-7890-8000-000000000023',
      toolKey: 'file_read',
      scopes: ['file.read'],
      enabled: true,
    },
  ]

  for (let i = 0; i < agentToolAssignments.length; i++) {
    const item = agentToolAssignments[i]!
    const toolId = toolMap.get(item.toolKey)
    if (!toolId) throw new Error(`Tool not found in catalog: ${item.toolKey}`)

    const seq = String(i + 1).padStart(12, '0')
    await db
      .insert(agentTools)
      .values({
        id: `01918361-b4f7-7890-e000-${seq}`,
        orgId: DEMO_ORG_ID,
        agentId: item.agentId,
        toolId,
        scopes: item.scopes,
        enabled: item.enabled,
      })
      .onConflictDoUpdate({
        target: [agentTools.agentId, agentTools.toolId],
        set: {
          scopes: item.scopes,
          enabled: item.enabled,
          updatedAt: new Date(),
        },
      })
  }

  // 7. Agent Skills
  const agentSkillAssignments: {
    agentId: string
    skillKey: string
    level: 'basic' | 'proficient' | 'expert'
  }[] = [
    // CEO: market_research, sales, accounting
    { agentId: '01918361-b4f7-7890-8000-000000000020', skillKey: 'market_research', level: 'expert' },
    { agentId: '01918361-b4f7-7890-8000-000000000020', skillKey: 'sales', level: 'proficient' },
    { agentId: '01918361-b4f7-7890-8000-000000000020', skillKey: 'accounting', level: 'proficient' },
    // Researcher: market_research, legal_research, seo
    { agentId: '01918361-b4f7-7890-8000-000000000021', skillKey: 'market_research', level: 'expert' },
    { agentId: '01918361-b4f7-7890-8000-000000000021', skillKey: 'legal_research', level: 'proficient' },
    { agentId: '01918361-b4f7-7890-8000-000000000021', skillKey: 'seo', level: 'proficient' },
    // Developer: typescript, nodejs, react, postgresql, docker
    { agentId: '01918361-b4f7-7890-8000-000000000022', skillKey: 'typescript', level: 'expert' },
    { agentId: '01918361-b4f7-7890-8000-000000000022', skillKey: 'nodejs', level: 'expert' },
    { agentId: '01918361-b4f7-7890-8000-000000000022', skillKey: 'react', level: 'proficient' },
    { agentId: '01918361-b4f7-7890-8000-000000000022', skillKey: 'postgresql', level: 'proficient' },
    { agentId: '01918361-b4f7-7890-8000-000000000022', skillKey: 'docker', level: 'proficient' },
    // Analyst: postgresql, accounting, market_research
    { agentId: '01918361-b4f7-7890-8000-000000000023', skillKey: 'postgresql', level: 'expert' },
    { agentId: '01918361-b4f7-7890-8000-000000000023', skillKey: 'accounting', level: 'expert' },
    { agentId: '01918361-b4f7-7890-8000-000000000023', skillKey: 'market_research', level: 'proficient' },
  ]

  for (let i = 0; i < agentSkillAssignments.length; i++) {
    const item = agentSkillAssignments[i]!
    const skillId = skillMap.get(item.skillKey)
    if (!skillId) throw new Error(`Skill not found in catalog: ${item.skillKey}`)

    const seq = String(i + 1).padStart(12, '0')
    await db
      .insert(agentSkills)
      .values({
        id: `01918361-b4f7-7890-f000-${seq}`,
        orgId: DEMO_ORG_ID,
        agentId: item.agentId,
        skillId,
        level: item.level,
      })
      .onConflictDoUpdate({
        target: [agentSkills.agentId, agentSkills.skillId],
        set: {
          level: item.level,
          updatedAt: new Date(),
        },
      })
  }
}

import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  createFixedClock,
  realIdGenerator,
  rootLogger,
  AUTONOMY_LEVELS,
  requiresApproval,
  isToolAssignable,
  type OrgRole,
} from '@ai-company/shared'
import {
  createDatabase,
  closeDatabase,
  createRepositories,
  auditLogs,
  sql,
  runSeed,
} from '@ai-company/db'
import { buildServer } from '../src/server.js'
import type { AppDeps } from '../src/deps.js'
import { isDatabaseReachable, truncateAll } from './helpers/db.js'
import { createQueryCounter } from './helpers/query-counter.js'

describe('AI Company OS - Step 6: Services, CRUD & Business Rules', () => {
  let dbAvailable = false
  const db = createDatabase()

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable()
  })

  afterAll(async () => {
    if (dbAvailable) {
      await closeDatabase()
    }
  })

  beforeEach(async () => {
    if (dbAvailable) {
      await truncateAll(db)
      await runSeed()
    }
  })

  function createTestServer(clock = createFixedClock(new Date('2026-08-25T12:00:00.000Z'))) {
    const deps: AppDeps = {
      db,
      repos: createRepositories(db, { clock, ids: realIdGenerator }),
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }
    const server = buildServer(deps)
    return { server, deps, clock }
  }

  async function registerUser(
    server: ReturnType<typeof buildServer>,
    opts?: {
      email?: string
      password?: string
      name?: string
      orgName?: string
      role?: OrgRole
    },
  ) {
    const email = opts?.email ?? 'test@example.com'
    const password = opts?.password ?? 'password-12345'
    const name = opts?.name ?? 'Test User'
    const organizationName = opts?.orgName ?? 'Test Org'

    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password, name, organizationName },
    })

    const body = res.json()
    const orgId = body.organizations[0].id
    const userId = body.user.id
    const accessToken = body.accessToken

    if (opts?.role && opts.role !== 'owner') {
      await db.execute(
        sql`UPDATE organization_members SET role = ${opts.role} WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid`,
      )
    }

    return {
      accessToken,
      orgId,
      userId,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-org-id': orgId,
      },
    }
  }

  // ==========================================
  // 1. КОМПАНИИ (Tests 1-5)
  // ==========================================
  describe('Part E1: Companies', () => {
    it('1. создание генерирует слаг; коллизия даёт -2', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const res1 = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Acme Corp' },
      })
      expect(res1.statusCode).toBe(201)
      const comp1 = res1.json()
      expect(comp1.slug).toBe('acme-corp')

      const res2 = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Acme Corp' },
      })
      expect(res2.statusCode).toBe(201)
      const comp2 = res2.json()
      expect(comp2.slug).toBe('acme-corp-2')
    })

    it('2. archive меняет статус и не удаляет строку; видна в общем списке и не видна при filter.status=active', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Archivable Corp' },
      })
      const company = createRes.json()

      const archiveRes = await server.inject({
        method: 'POST',
        url: `/v1/companies/${company.id}/archive`,
        headers: user.headers,
      })
      expect(archiveRes.statusCode).toBe(200)
      expect(archiveRes.json().status).toBe('archived')

      // List all
      const listAllRes = await server.inject({
        method: 'GET',
        url: '/v1/companies',
        headers: user.headers,
      })
      expect(listAllRes.statusCode).toBe(200)
      const allItems = listAllRes.json().items
      expect(
        allItems.some(
          (c: { id: string; status: string }) =>
            c.id === company.id && c.status === 'archived',
        ),
      ).toBe(true)

      // List active only
      const listActiveRes = await server.inject({
        method: 'GET',
        url: '/v1/companies?status=active',
        headers: user.headers,
      })
      expect(listActiveRes.statusCode).toBe(200)
      const activeItems = listActiveRes.json().items
      expect(activeItems.some((c: { id: string }) => c.id === company.id)).toBe(false)
    })

    it('3. viewer получает 403 на создание, 200 на чтение', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const owner = await registerUser(server, { email: 'owner@example.com' })

      // Create company as owner
      const compRes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: owner.headers,
        payload: { name: 'Owner Corp' },
      })
      const compId = compRes.json().id

      // Create viewer user in same org
      const viewer = await registerUser(server, {
        email: 'viewer@example.com',
        orgName: 'Viewer Org',
        role: 'viewer',
      })
      // Attach viewer to owner's org with role viewer
      await db.execute(
        sql`INSERT INTO organization_members (id, org_id, user_id, role) VALUES (gen_random_uuid(), ${owner.orgId}::uuid, ${viewer.userId}::uuid, 'viewer')`,
      )

      const viewerHeaders = {
        authorization: `Bearer ${viewer.accessToken}`,
        'x-org-id': owner.orgId,
      }

      // Viewer cannot create company (403)
      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: viewerHeaders,
        payload: { name: 'Viewer Created' },
      })
      expect(createRes.statusCode).toBe(403)

      // Viewer CAN read company (200)
      const getRes = await server.inject({
        method: 'GET',
        url: `/v1/companies/${compId}`,
        headers: viewerHeaders,
      })
      expect(getRes.statusCode).toBe(200)
      expect(getRes.json().name).toBe('Owner Corp')
    })

    it('4. org-chart: два корневых отдела, у одного дочерний, агент без отдела — структура собрана верно', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      // 1. Create company
      const compRes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Tree Corp' },
      })
      const companyId = compRes.json().id

      // 2. Create dept Root A
      const deptARes = await server.inject({
        method: 'POST',
        url: '/v1/departments',
        headers: user.headers,
        payload: { companyId, name: 'Engineering', code: 'ENG' },
      })
      const deptAId = deptARes.json().id

      // 3. Create dept Child A1 under Engineering
      const deptA1Res = await server.inject({
        method: 'POST',
        url: '/v1/departments',
        headers: user.headers,
        payload: { companyId, parentDepartmentId: deptAId, name: 'Backend', code: 'BACK' },
      })
      const deptA1Id = deptA1Res.json().id

      // 4. Create dept Root B
      const deptBRes = await server.inject({
        method: 'POST',
        url: '/v1/departments',
        headers: user.headers,
        payload: { companyId, name: 'Product', code: 'PROD' },
      })
      const deptBId = deptBRes.json().id

      // 5. Create CEO Agent (unassigned to department, manager = null)
      const ceoRes = await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId,
          name: 'Chief Executive',
          role: 'ceo',
          title: 'CEO',
          systemPrompt: 'You lead the company',
        },
      })
      const ceo = ceoRes.json()

      // 6. Create Agent in Backend dept (managed by CEO)
      const devRes = await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId,
          departmentId: deptA1Id,
          managerId: ceo.id,
          name: 'Backend Dev 1',
          role: 'developer',
          title: 'Senior Engineer',
          systemPrompt: 'Write code',
        },
      })
      expect(devRes.statusCode).toBe(201)

      // 7. Get org-chart
      const chartRes = await server.inject({
        method: 'GET',
        url: `/v1/companies/${companyId}/org-chart`,
        headers: user.headers,
      })
      expect(chartRes.statusCode).toBe(200)
      const chart = chartRes.json()

      expect(chart.company.id).toBe(companyId)
      expect(chart.departments.length).toBe(2) // Engineering, Product

      const engDept = chart.departments.find((d: { id: string }) => d.id === deptAId)
      const prodDept = chart.departments.find((d: { id: string }) => d.id === deptBId)
      expect(engDept).toBeDefined()
      expect(prodDept).toBeDefined()

      expect(engDept.children.length).toBe(1)
      expect(engDept.children[0].id).toBe(deptA1Id)
      expect(engDept.children[0].agents.length).toBe(1)
      expect(engDept.children[0].agents[0].name).toBe('Backend Dev 1')

      expect(chart.unassignedAgents.length).toBe(1)
      expect(chart.unassignedAgents[0].name).toBe('Chief Executive')
    })

    it('5. org-chart выполняет фиксированное число запросов к БД независимо от размера дерева', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      // Company A with 3 departments
      const compARes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Small Tree Corp' },
      })
      const compAId = compARes.json().id

      for (let i = 1; i <= 3; i++) {
        await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: {
            companyId: compAId,
            name: `Dept A${i}`,
            code: `DA${i}`,
          },
        })
      }

      // Company B with 30 departments (across multiple levels within max depth 5)
      const compBRes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Large Tree Corp' },
      })
      const compBId = compBRes.json().id

      for (let i = 1; i <= 30; i++) {
        await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: {
            companyId: compBId,
            name: `Dept B${i}`,
            code: `DB${i}`,
          },
        })
      }

      // Attach QueryCounter to pg and measure Company A (3 depts)
      const counter = createQueryCounter()
      counter.reset()

      const resA = await server.inject({
        method: 'GET',
        url: `/v1/companies/${compAId}/org-chart`,
        headers: user.headers,
      })
      expect(resA.statusCode).toBe(200)
      const countA = counter.getCount()

      // Reset and measure Company B (30 depts)
      counter.reset()
      const resB = await server.inject({
        method: 'GET',
        url: `/v1/companies/${compBId}/org-chart`,
        headers: user.headers,
      })
      expect(resB.statusCode).toBe(200)
      const countB = counter.getCount()
      counter.restore()

      // Exact equality: query count is completely constant regardless of tree size
      expect(countA).toBe(countB)
      expect(countA).toBeGreaterThan(0)
    })
  })

  // ==========================================
  // 2. ОТДЕЛЫ (Tests 6-10)
  // ==========================================
  describe('Part E2: Departments', () => {
    it('6. отдел не может стать собственным родителем → 409 DEPARTMENT_CYCLE', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const compRes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Dept Corp' },
      })
      const companyId = compRes.json().id

      const deptRes = await server.inject({
        method: 'POST',
        url: '/v1/departments',
        headers: user.headers,
        payload: { companyId, name: 'Ops', code: 'OPS' },
      })
      const deptId = deptRes.json().id

      const updateRes = await server.inject({
        method: 'PATCH',
        url: `/v1/departments/${deptId}`,
        headers: user.headers,
        payload: { parentDepartmentId: deptId },
      })

      expect(updateRes.statusCode).toBe(409)
      expect(updateRes.json().error.code).toBe('DEPARTMENT_CYCLE')
    })

    it('7. цикл через внука (A→B→C, затем A.parent = C) → 409 DEPARTMENT_CYCLE', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const compRes = await server.inject({
        method: 'POST',
        url: '/v1/companies',
        headers: user.headers,
        payload: { name: 'Cycle Corp' },
      })
      const companyId = compRes.json().id

      // A
      const deptA = (
        await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: { companyId, name: 'Dept A', code: 'DA' },
        })
      ).json()

      // B under A
      const deptB = (
        await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: { companyId, parentDepartmentId: deptA.id, name: 'Dept B', code: 'DB' },
        })
      ).json()

      // C under B
      const deptC = (
        await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: { companyId, parentDepartmentId: deptB.id, name: 'Dept C', code: 'DC' },
        })
      ).json()

      // Now try to set A.parent = C (cycle: C -> B -> A -> C)
      const cycleRes = await server.inject({
        method: 'PATCH',
        url: `/v1/departments/${deptA.id}`,
        headers: user.headers,
        payload: { parentDepartmentId: deptC.id },
      })

      expect(cycleRes.statusCode).toBe(409)
      expect(cycleRes.json().error.code).toBe('DEPARTMENT_CYCLE')
    })

    it('8. родитель из другой компании → 400', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const comp1 = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Company 1' },
        })
      ).json()

      const comp2 = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Company 2' },
        })
      ).json()

      const dept1 = (
        await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: { companyId: comp1.id, name: 'Dept 1', code: 'D1' },
        })
      ).json()

      // Try creating dept in Company 2 with parent from Company 1
      const res = await server.inject({
        method: 'POST',
        url: '/v1/departments',
        headers: user.headers,
        payload: { companyId: comp2.id, parentDepartmentId: dept1.id, name: 'Dept 2', code: 'D2' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('9. удаление отдела с агентами → 409 с details.agentCount', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Delete Dept Corp' },
        })
      ).json()

      const dept = (
        await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: { companyId: company.id, name: 'Staffed Dept', code: 'STAFF' },
        })
      ).json()

      await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId: company.id,
          departmentId: dept.id,
          name: 'Assigned Agent',
          role: 'dev',
          title: 'Engineer',
          systemPrompt: 'Prompt',
        },
      })

      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/v1/departments/${dept.id}`,
        headers: user.headers,
      })

      expect(deleteRes.statusCode).toBe(409)
      const body = deleteRes.json()
      expect(body.error.code).toBe('CONFLICT')
      expect(body.error.details.agentCount).toBe(1)
    })

    it('10. глубина 6 уровней → 400', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Deep Dept Corp' },
        })
      ).json()

      let parentId: string | null = null
      for (let level = 1; level <= 5; level++) {
        const response = await server.inject({
          method: 'POST',
          url: '/v1/departments',
          headers: user.headers,
          payload: {
            companyId: company.id,
            parentDepartmentId: parentId,
            name: `Level ${level}`,
            code: `L${level}`,
          },
        })
        expect(response.statusCode).toBe(201)
        const created: { id: string } = response.json()
        parentId = created.id
      }

      // Level 6 creation should be rejected with 400
      const level6Res = await server.inject({
        method: 'POST',
        url: '/v1/departments',
        headers: user.headers,
        payload: {
          companyId: company.id,
          parentDepartmentId: parentId,
          name: 'Level 6',
          code: 'L6',
        },
      })

      expect(level6Res.statusCode).toBe(400)
      expect(level6Res.json().error.code).toBe('VALIDATION_ERROR')
    })
  })

  // ==========================================
  // 3. АГЕНТЫ (Tests 11-21)
  // ==========================================
  describe('Part E3: Agents', () => {
    it('11. дубликат имени в компании → 409; то же имя в другой компании — успех', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const compA = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Company Alpha' },
        })
      ).json()

      const compB = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Company Beta' },
        })
      ).json()

      // Agent 1 in Alpha
      const res1 = await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId: compA.id,
          name: 'UniqueBot',
          role: 'bot',
          title: 'Bot',
          systemPrompt: 'Bot',
        },
      })
      expect(res1.statusCode).toBe(201)

      // Duplicate name in Alpha -> 409
      const res2 = await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId: compA.id,
          name: 'UniqueBot',
          role: 'bot',
          title: 'Bot',
          systemPrompt: 'Bot',
        },
      })
      expect(res2.statusCode).toBe(409)

      // Same name in Beta -> 201 (success)
      const res3 = await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId: compB.id,
          name: 'UniqueBot',
          role: 'bot',
          title: 'Bot',
          systemPrompt: 'Bot',
        },
      })
      expect(res3.statusCode).toBe(201)
    })

    it('12. цикл в manager_agent_id через трёх агентов → 409 AGENT_CYCLE', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Agent Cycle Corp' },
        })
      ).json()

      // CEO: Agent A
      const agentA = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Agent A',
            role: 'lead',
            title: 'Lead',
            systemPrompt: 'Lead',
          },
        })
      ).json()

      // Agent B managed by A
      const agentB = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            managerId: agentA.id,
            name: 'Agent B',
            role: 'manager',
            title: 'Mgr',
            systemPrompt: 'Mgr',
          },
        })
      ).json()

      // Agent C managed by B
      const agentC = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            managerId: agentB.id,
            name: 'Agent C',
            role: 'worker',
            title: 'Wkr',
            systemPrompt: 'Wkr',
          },
        })
      ).json()

      // Try setting A.managerId = C -> cycle C -> B -> A -> C
      const cycleRes = await server.inject({
        method: 'PATCH',
        url: `/v1/agents/${agentA.id}`,
        headers: user.headers,
        payload: { managerId: agentC.id },
      })

      expect(cycleRes.statusCode).toBe(409)
      expect(cycleRes.json().error.code).toBe('AGENT_CYCLE')
    })

    it('13. второй агент без руководителя в той же компании → 409 CONFLICT', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'One CEO Corp' },
        })
      ).json()

      // First CEO
      const ceo1 = await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId: company.id,
          name: 'First CEO',
          role: 'ceo',
          title: 'CEO',
          systemPrompt: 'Prompt',
        },
      })
      expect(ceo1.statusCode).toBe(201)

      // Second CEO in same company -> 409
      const ceo2 = await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId: company.id,
          name: 'Second CEO',
          role: 'ceo',
          title: 'CEO',
          systemPrompt: 'Prompt',
        },
      })
      expect(ceo2.statusCode).toBe(409)
      expect(ceo2.json().error.code).toBe('CONFLICT')
    })

    it('14. setModels без preferred → 400; с двумя preferred → 400; без fallback → 400', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Models Corp' },
        })
      ).json()

      const agent = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Model Tester',
            role: 'dev',
            title: 'Dev',
            systemPrompt: 'Dev',
          },
        })
      ).json()

      // 0 preferred (all fallback)
      const noPrefRes = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/models`,
        headers: user.headers,
        payload: {
          models: [
            { modelKey: 'claude-sonnet-5', role: 'fallback' },
            { modelKey: 'claude-opus-5', role: 'fallback' },
          ],
        },
      })
      expect(noPrefRes.statusCode).toBe(400)

      // 2 preferred
      const twoPrefRes = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/models`,
        headers: user.headers,
        payload: {
          models: [
            { modelKey: 'claude-sonnet-5', role: 'preferred' },
            { modelKey: 'claude-opus-5', role: 'preferred' },
          ],
        },
      })
      expect(twoPrefRes.statusCode).toBe(400)

      // 0 fallback
      const noFallbackRes = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/models`,
        headers: user.headers,
        payload: {
          models: [{ modelKey: 'claude-sonnet-5', role: 'preferred' }],
        },
      })
      expect(noFallbackRes.statusCode).toBe(400)
    })

    it('15. setModels с deprecated-моделью → 400', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      // Mark claude-haiku-4-5-20251001 as deprecated in catalog
      await db.execute(
        sql`UPDATE models SET status = 'deprecated' WHERE model_key = 'claude-haiku-4-5-20251001'`,
      )

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Deprecated Model Corp' },
        })
      ).json()

      const agent = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Agent Dep',
            role: 'dev',
            title: 'Dev',
            systemPrompt: 'Dev',
          },
        })
      ).json()

      const res = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/models`,
        headers: user.headers,
        payload: {
          models: [
            { modelKey: 'claude-sonnet-5', role: 'preferred' },
            { modelKey: 'claude-haiku-4-5-20251001', role: 'fallback' },
          ],
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('16. setTools с инструментом уровня 3 при maxAutonomyLevel = 1 → 400', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Tool Level 3 Corp' },
        })
      ).json()

      const agent = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Low Autonomy Agent',
            role: 'dev',
            title: 'Dev',
            systemPrompt: 'Dev',
            maxAutonomyLevel: 1,
          },
        })
      ).json()

      const res = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/tools`,
        headers: user.headers,
        payload: {
          tools: [{ toolKey: 'payment_execute' }],
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })

    it('17. setTools с инструментом уровня 2 при maxAutonomyLevel = 1 → успех, requiresApproval: true', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Tool Level 2 Corp' },
        })
      ).json()

      const agent = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Mid Autonomy Agent',
            role: 'dev',
            title: 'Dev',
            systemPrompt: 'Dev',
            maxAutonomyLevel: 1,
          },
        })
      ).json()

      const res = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/tools`,
        headers: user.headers,
        payload: {
          tools: [{ toolKey: 'github_pr_create' }],
        },
      })

      expect(res.statusCode).toBe(200)
      const updatedView = res.json()
      const tool = updatedView.tools.find((t: { key: string }) => t.key === 'github_pr_create')
      expect(tool).toBeDefined()
      expect(tool.autonomyLevel).toBe(2)
      expect(tool.requiresApproval).toBe(true)
    })

    it('18. снижение maxAutonomyLevel при назначенном инструменте уровня 3 → 409', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Autonomy Drop Corp' },
        })
      ).json()

      // Create agent with maxAutonomyLevel = 3
      const agent = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Financial Bot',
            role: 'cfo',
            title: 'CFO',
            systemPrompt: 'CFO',
            maxAutonomyLevel: 3,
          },
        })
      ).json()

      // Assign level 3 tool
      await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/tools`,
        headers: user.headers,
        payload: {
          tools: [{ toolKey: 'payment_execute' }],
        },
      })

      // Try reducing maxAutonomyLevel to 2
      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/v1/agents/${agent.id}`,
        headers: user.headers,
        payload: { maxAutonomyLevel: 2 },
      })

      expect(patchRes.statusCode).toBe(409)
      expect(patchRes.json().error.code).toBe('CONFLICT')
    })

    it('19. retire агента с подчинёнными → 409', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Retire Corp' },
        })
      ).json()

      const manager = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Active Lead',
            role: 'lead',
            title: 'Lead',
            systemPrompt: 'Lead',
          },
        })
      ).json()

      await server.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: user.headers,
        payload: {
          companyId: company.id,
          managerId: manager.id,
          name: 'Subordinate',
          role: 'dev',
          title: 'Dev',
          systemPrompt: 'Dev',
        },
      })

      const retireRes = await server.inject({
        method: 'POST',
        url: `/v1/agents/${manager.id}/retire`,
        headers: user.headers,
      })

      expect(retireRes.statusCode).toBe(409)
      expect(retireRes.json().error.code).toBe('CONFLICT')
    })

    it('20. GET /v1/agents для 20 агентов выполняет константное число запросов (не N+1)', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Batch Agents Corp' },
        })
      ).json()

      // CEO
      const ceo = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'CEO Bot',
            role: 'ceo',
            title: 'CEO',
            systemPrompt: 'CEO',
          },
        })
      ).json()

      // Create 19 more agents
      for (let i = 1; i <= 19; i++) {
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            managerId: ceo.id,
            name: `Agent ${i}`,
            role: 'dev',
            title: `Dev ${i}`,
            systemPrompt: 'Prompt',
          },
        })
      }

      // Measure query count for listing 20 agents
      const counter = createQueryCounter()
      counter.reset()

      const listRes = await server.inject({
        method: 'GET',
        url: `/v1/agents?companyId=${company.id}&limit=50`,
        headers: user.headers,
      })
      expect(listRes.statusCode).toBe(200)
      expect(listRes.json().items.length).toBe(20)

      const queryCount = counter.getCount()
      counter.restore()

      // Zero N+1: auth (1) + agents (1) + agent_models (1) + agent_tools (1) + agent_skills (1) + catalog lookups (3) <= 8 queries
      expect(queryCount).toBeLessThanOrEqual(8)
    })

    it('21. AgentView собирается корректно: modelPolicy, skills, tools с флагами', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const company = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Full View Corp' },
        })
      ).json()

      const agent = (
        await server.inject({
          method: 'POST',
          url: '/v1/agents',
          headers: user.headers,
          payload: {
            companyId: company.id,
            name: 'Full View Agent',
            role: 'fullstack',
            title: 'Lead Architect',
            systemPrompt: 'Build great software',
            maxAutonomyLevel: 2,
          },
        })
      ).json()

      // Set models
      const setModelsRes = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/models`,
        headers: user.headers,
        payload: {
          models: [
            { modelKey: 'claude-sonnet-5', role: 'preferred' },
            { modelKey: 'claude-opus-5', role: 'fallback' },
          ],
        },
      })
      expect(setModelsRes.statusCode).toBe(200)

      // Set tools
      const setToolsRes = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/tools`,
        headers: user.headers,
        payload: {
          tools: [
            { toolKey: 'file_read', scopes: ['fs.read'] },
            { toolKey: 'github_pr_create', scopes: ['pr.create'] },
          ],
        },
      })
      expect(setToolsRes.statusCode).toBe(200)

      // Set skills
      const setSkillsRes = await server.inject({
        method: 'PUT',
        url: `/v1/agents/${agent.id}/skills`,
        headers: user.headers,
        payload: {
          skills: [{ skillKey: 'typescript' }, { skillKey: 'docker' }],
        },
      })
      expect(setSkillsRes.statusCode).toBe(200)

      const getRes = await server.inject({
        method: 'GET',
        url: `/v1/agents/${agent.id}`,
        headers: user.headers,
      })
      expect(getRes.statusCode).toBe(200)
      const view = getRes.json()

      expect(view.modelPolicy.preferred).toBe('claude-sonnet-5')
      expect(view.modelPolicy.fallback).toEqual(['claude-opus-5'])
      expect(view.skills.sort()).toEqual(['docker', 'typescript'])
      expect(view.tools.length).toBe(2)

      const fileReadTool = view.tools.find((t: { key: string }) => t.key === 'file_read')
      expect(fileReadTool.autonomyLevel).toBe(0)
      expect(fileReadTool.requiresApproval).toBe(false)

      const prTool = view.tools.find((t: { key: string }) => t.key === 'github_pr_create')
      expect(prTool.autonomyLevel).toBe(2)
      expect(prTool.requiresApproval).toBe(true)
    })
  })

  // ==========================================
  // 4. СЕКРЕТЫ (Tests 22-24)
  // ==========================================
  describe('Part E4: Secrets', () => {
    it('22. member получает 403 на PUT /v1/secrets/:key', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const owner = await registerUser(server, { email: 'owner_sec@example.com' })

      const member = await registerUser(server, {
        email: 'member_sec@example.com',
        orgName: 'Member Org',
        role: 'member',
      })
      await db.execute(
        sql`INSERT INTO organization_members (id, org_id, user_id, role) VALUES (gen_random_uuid(), ${owner.orgId}::uuid, ${member.userId}::uuid, 'member')`,
      )

      const memberHeaders = {
        authorization: `Bearer ${member.accessToken}`,
        'x-org-id': owner.orgId,
      }

      const res = await server.inject({
        method: 'PUT',
        url: '/v1/secrets/STRIPE_API_KEY',
        headers: memberHeaders,
        payload: { value: 'sk_test_12345' },
      })

      expect(res.statusCode).toBe(403)
    })

    it('23. значение секрета не встречается ни в одном ответе и ни в одной записи audit log', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const secretRawValue = 'super-confidential-token-value-999'

      // Set secret
      const setRes = await server.inject({
        method: 'PUT',
        url: '/v1/secrets/OPENAI_API_KEY',
        headers: user.headers,
        payload: { value: secretRawValue },
      })
      expect(setRes.statusCode).toBe(200)
      expect(JSON.stringify(setRes.json())).not.toContain(secretRawValue)

      // List secrets
      const listRes = await server.inject({
        method: 'GET',
        url: '/v1/secrets',
        headers: user.headers,
      })
      expect(listRes.statusCode).toBe(200)
      expect(JSON.stringify(listRes.json())).not.toContain(secretRawValue)

      // Check DB audit logs
      const auditRows = await db.select().from(auditLogs).where(sql`resource_type = 'secret'`)
      expect(auditRows.length).toBeGreaterThan(0)
      for (const row of auditRows) {
        expect(JSON.stringify(row)).not.toContain(secretRawValue)
      }
    })

    it('24. невалидный ключ (lowercase) → 400', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const res = await server.inject({
        method: 'PUT',
        url: '/v1/secrets/invalid_key_name',
        headers: user.headers,
        payload: { value: 'some-value' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    })
  })

  // ==========================================
  // 5. ИЗОЛЯЦИЯ И АУДИТ (Tests 25-27)
  // ==========================================
  describe('Part E5: Tenant Isolation and Platform Audit', () => {
    it('25. все новые роуты: объект чужой организации даёт 404, а не 403', async ({ skip }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const orgA = await registerUser(server, { email: 'orgA@example.com', orgName: 'Org A' })
      const orgB = await registerUser(server, { email: 'orgB@example.com', orgName: 'Org B' })

      // Create company in Org A
      const compA = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: orgA.headers,
          payload: { name: 'Alpha Corp' },
        })
      ).json()

      // User from Org B tries to access Org A company
      const res = await server.inject({
        method: 'GET',
        url: `/v1/companies/${compA.id}`,
        headers: orgB.headers,
      })

      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('NOT_FOUND')
    })

    it('26. создание, изменение и архивация компании порождают записи в audit log', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server)

      const comp = (
        await server.inject({
          method: 'POST',
          url: '/v1/companies',
          headers: user.headers,
          payload: { name: 'Audit Test Corp' },
        })
      ).json()

      await server.inject({
        method: 'PATCH',
        url: `/v1/companies/${comp.id}`,
        headers: user.headers,
        payload: { name: 'Audit Updated Corp' },
      })

      await server.inject({
        method: 'POST',
        url: `/v1/companies/${comp.id}/archive`,
        headers: user.headers,
      })

      const logsRes = await server.inject({
        method: 'GET',
        url: `/v1/audit-logs?resourceType=company&resourceId=${comp.id}`,
        headers: user.headers,
      })

      expect(logsRes.statusCode).toBe(200)
      const items = logsRes.json().items
      const actions = items.map((i: { action: string }) => i.action)
      expect(actions).toContain('company.create')
      expect(actions).toContain('company.update')
      expect(actions).toContain('company.archive')
    })

    it('27. события auth.login больше НЕ появляются в GET /v1/audit-logs (они платформенные с org_id = null)', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { server } = createTestServer()
      const user = await registerUser(server, {
        email: 'platform_audit@example.com',
        password: 'password-12345',
      })

      // Perform login
      await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'platform_audit@example.com', password: 'password-12345' },
      })

      // Get org-level audit logs
      const logsRes = await server.inject({
        method: 'GET',
        url: '/v1/audit-logs',
        headers: user.headers,
      })

      expect(logsRes.statusCode).toBe(200)
      const items = logsRes.json().items
      const actions = items.map((i: { action: string }) => i.action)

      // Must NOT contain auth.login or auth.register
      expect(actions).not.toContain('auth.login')
      expect(actions).not.toContain('auth.register')

      // But in DB, the platform audit log exists with org_id IS NULL
      const platformRows = await db
        .select()
        .from(auditLogs)
        .where(sql`org_id IS NULL AND action = 'auth.login'`)
      expect(platformRows.length).toBeGreaterThan(0)
    })
  })

  // ==========================================
  // 6. АВТОНОМНОСТЬ (Test 28)
  // ==========================================
  describe('Part E6: Autonomy Truth Table', () => {
    it('28. таблица истинности requiresApproval и isToolAssignable для всех 16 сочетаний', () => {
      const levels = [
        AUTONOMY_LEVELS.READ,
        AUTONOMY_LEVELS.INTERNAL_WRITE,
        AUTONOMY_LEVELS.EXTERNAL_ACTION,
        AUTONOMY_LEVELS.CRITICAL,
      ]

      for (const toolLevel of levels) {
        for (const agentMax of levels) {
          const approval = requiresApproval(toolLevel, agentMax)
          const assignable = isToolAssignable(toolLevel, agentMax)

          const expectedApproval = toolLevel >= 2 || toolLevel > agentMax
          const expectedAssignable = !(toolLevel === 3 && agentMax < 3)

          expect(approval).toBe(expectedApproval)
          expect(assignable).toBe(expectedAssignable)
        }
      }
    })
  })
})

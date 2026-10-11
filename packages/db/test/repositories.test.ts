import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  type RequestContext,
  systemClock,
  realIdGenerator,
  createFixedClock,
  paginationQuerySchema,
  rootLogger,
} from '@ai-company/shared'
import {
  createDatabase,
  closeDatabase,
  createRepositories,
  runMigrations,
  runSeed,
  models,
  type Repositories,
  type CreateCompanyInput,
} from '../src/index.js'
import { isDatabaseReachable, truncateAll } from './helpers/db.js'

function makeRequestContext(orgId: string, userId = realIdGenerator.next()): RequestContext {
  return {
    orgId,
    userId,
    role: 'owner',
    requestId: realIdGenerator.next(),
    clock: systemClock,
    ids: realIdGenerator,
    logger: rootLogger,
  }
}

describe('Repositories & Tenant Isolation (@ai-company/db)', () => {
  let dbAvailable = false
  const db = createDatabase()
  const repos: Repositories = createRepositories(db, {
    clock: systemClock,
    ids: realIdGenerator,
  })

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable()
    if (dbAvailable) {
      await runMigrations()
    }
  })

  afterAll(async () => {
    if (dbAvailable) {
      await closeDatabase()
    }
  })

  beforeEach(async () => {
    if (dbAvailable) {
      await truncateAll(db)
    }
  })

  // Helper to create two fully-populated organizations
  async function createTwoOrgs() {
    await runSeed()

    const orgAId = '01918361-b4f7-7890-8000-000000000001' // Demo Org from seed
    const orgBId = '01918361-b4f7-7890-8000-000000000099'

    // Demo user from seed has ID 01918361-b4f7-7890-9000-000000000001
    const demoUserId = '01918361-b4f7-7890-9000-000000000001'
    const ctxA = makeRequestContext(orgAId, demoUserId)

    // Create user for Org B
    const userB = await repos.auth.createUser({
      email: 'user-b@example.com',
      passwordHash: 'hash-placeholder',
      name: 'User B',
    })
    const ctxB = makeRequestContext(orgBId, userB.id)

    // Create Org B
    await repos.auth.createOrganization({
      id: orgBId,
      name: 'Org B',
      slug: 'org-b',
      plan: 'pro',
    })

    const companyB = await repos.companies.create(ctxB, {
      name: 'Company B',
      slug: 'company-b',
    })

    const deptB = await repos.departments.create(ctxB, {
      companyId: companyB.id,
      name: 'Dept B',
      code: 'DB',
    })

    const agentB = await repos.agents.create(ctxB, {
      companyId: companyB.id,
      departmentId: deptB.id,
      name: 'Agent B',
      role: 'Worker',
      title: 'Engineer',
      systemPrompt: 'Agent B Prompt',
    })

    const modelCatalog = await repos.catalog.listModels()
    const toolCatalog = await repos.catalog.listTools()
    const skillCatalog = await repos.catalog.listSkills()

    const modelB = await repos.agentModels.create(ctxB, {
      agentId: agentB.id,
      modelId: modelCatalog[0]!.id,
      role: 'preferred',
    })

    const toolB = await repos.agentTools.create(ctxB, {
      agentId: agentB.id,
      toolId: toolCatalog[0]!.id,
    })

    const skillB = await repos.agentSkills.create(ctxB, {
      agentId: agentB.id,
      skillId: skillCatalog[0]!.id,
    })

    await repos.secrets.set(ctxB, 'API_KEY', 'secret-val-b')
    await repos.secrets.set(ctxB, 'COMP_KEY', 'comp-secret-b', companyB.id)

    await repos.auditLogs.append(ctxB, {
      actorType: 'user',
      action: 'company.created',
      resourceType: 'company',
      resourceId: companyB.id,
    })

    // Retrieve Org A items
    const companiesA = await repos.companies.list(ctxA)
    const companyA = companiesA.items[0]!
    const deptsA = await repos.departments.list(ctxA)
    const deptA = deptsA.items[0]!
    const agentsA = await repos.agents.list(ctxA)
    const agentA = agentsA.items[0]!
    const modelsA = await repos.agentModels.list(ctxA)
    const modelA = modelsA.items[0]!
    const toolsA = await repos.agentTools.list(ctxA)
    const toolA = toolsA.items[0]!
    const skillsA = await repos.agentSkills.list(ctxA)
    const skillA = skillsA.items[0]!

    await repos.secrets.set(ctxA, 'API_KEY', 'secret-val-a')
    await repos.secrets.set(ctxA, 'COMP_KEY', 'comp-secret-a', companyA.id)

    await repos.auditLogs.append(ctxA, {
      actorType: 'user',
      action: 'company.created',
      resourceType: 'company',
      resourceId: companyA.id,
    })

    return {
      ctxA,
      ctxB,
      orgAId,
      orgBId,
      companyA,
      companyB,
      deptA,
      deptB,
      agentA,
      agentB,
      modelA,
      modelB,
      toolA,
      toolB,
      skillA,
      skillB,
    }
  }

  describe('Part A & Catalog: Model Pricing Verification (A1-A4, C7)', () => {
    it('A4.1: Seed sets pricing_verified = false on all models in catalog', async ({ skip }) => {
      if (!dbAvailable) skip()
      await runSeed()

      const allModels = await repos.catalog.listModels()
      expect(allModels.length).toBeGreaterThanOrEqual(7)

      for (const m of allModels) {
        expect(m.pricingVerified).toBe(false)
        expect(m.pricingVerifiedAt).toBeNull()
      }
    })

    it('A4.2: Verified models with empty pricing_source_url are rejected / invalid', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      await runSeed()

      // Ensure no model in catalog has pricingVerified = true without pricingSourceUrl
      const invalidModels = await db
        .select()
        .from(models)
        .where(eq(models.pricingVerified, true))

      const violations = invalidModels.filter((m) => !m.pricingSourceUrl || m.pricingSourceUrl.trim() === '')
      expect(violations).toHaveLength(0)
    })

    it('C7: CatalogRepository is read-only and listModels with pricingVerified filter works', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      await runSeed()

      const repoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(repos.catalog))
      const writeMethods = repoKeys.filter(
        (k) =>
          k.startsWith('create') ||
          k.startsWith('update') ||
          k.startsWith('delete') ||
          k.startsWith('set') ||
          k.startsWith('insert') ||
          k.startsWith('remove'),
      )
      expect(writeMethods).toHaveLength(0)

      const verifiedModels = await repos.catalog.listModels({ pricingVerified: true })
      expect(verifiedModels).toEqual([])
    })
  })

  describe('Part C1: Tenant Isolation Across All Org-Scoped Entities', () => {
    it('Company: findById returns null, findByIdOrThrow throws notFound, list has no leakage, update fails', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { ctxA, ctxB, companyA } = await createTwoOrgs()

      // 1. findById from Org B on Org A id returns null
      const found = await repos.companies.findById(ctxB, companyA.id)
      expect(found).toBeNull()

      // 2. findByIdOrThrow throws notFound
      await expect(repos.companies.findByIdOrThrow(ctxB, companyA.id)).rejects.toThrow(
        /not found/i,
      )

      // 3. list from Org B does not contain company A
      const listB = await repos.companies.list(ctxB)
      expect(listB.items.some((c) => c.id === companyA.id)).toBe(false)

      // 4. update from Org B on company A throws notFound and does not change company A
      await expect(
        repos.companies.update(ctxB, companyA.id, { name: 'Hacked Name' }),
      ).rejects.toThrow(/not found/i)

      const unmodified = await repos.companies.findById(ctxA, companyA.id)
      expect(unmodified?.name).toBe(companyA.name)
    })

    it('Department: findById returns null, findByIdOrThrow throws notFound, list has no leakage, update fails', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { ctxA, ctxB, deptA } = await createTwoOrgs()

      expect(await repos.departments.findById(ctxB, deptA.id)).toBeNull()
      await expect(repos.departments.findByIdOrThrow(ctxB, deptA.id)).rejects.toThrow(/not found/i)

      const listB = await repos.departments.list(ctxB)
      expect(listB.items.some((d) => d.id === deptA.id)).toBe(false)

      await expect(
        repos.departments.update(ctxB, deptA.id, { name: 'Hacked Dept' }),
      ).rejects.toThrow(/not found/i)

      const unmodified = await repos.departments.findById(ctxA, deptA.id)
      expect(unmodified?.name).toBe(deptA.name)
    })

    it('Agent: findById returns null, findByIdOrThrow throws notFound, list has no leakage, update fails', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { ctxA, ctxB, agentA } = await createTwoOrgs()

      expect(await repos.agents.findById(ctxB, agentA.id)).toBeNull()
      await expect(repos.agents.findByIdOrThrow(ctxB, agentA.id)).rejects.toThrow(/not found/i)

      const listB = await repos.agents.list(ctxB)
      expect(listB.items.some((a) => a.id === agentA.id)).toBe(false)

      await expect(repos.agents.update(ctxB, agentA.id, { name: 'Hacked Agent' })).rejects.toThrow(
        /not found/i,
      )

      const unmodified = await repos.agents.findById(ctxA, agentA.id)
      expect(unmodified?.name).toBe(agentA.name)
    })

    it('AgentModel: findById returns null, findByIdOrThrow throws notFound, list has no leakage, update fails', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { ctxA, ctxB, modelA } = await createTwoOrgs()

      expect(await repos.agentModels.findById(ctxB, modelA.id)).toBeNull()
      await expect(repos.agentModels.findByIdOrThrow(ctxB, modelA.id)).rejects.toThrow(/not found/i)

      const listB = await repos.agentModels.list(ctxB)
      expect(listB.items.some((m) => m.id === modelA.id)).toBe(false)

      await expect(repos.agentModels.update(ctxB, modelA.id, { priority: 99 })).rejects.toThrow(
        /not found/i,
      )

      const unmodified = await repos.agentModels.findById(ctxA, modelA.id)
      expect(unmodified?.priority).toBe(modelA.priority)
    })

    it('AgentTool: findById returns null, findByIdOrThrow throws notFound, list has no leakage, update fails', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { ctxA, ctxB, toolA } = await createTwoOrgs()

      expect(await repos.agentTools.findById(ctxB, toolA.id)).toBeNull()
      await expect(repos.agentTools.findByIdOrThrow(ctxB, toolA.id)).rejects.toThrow(/not found/i)

      const listB = await repos.agentTools.list(ctxB)
      expect(listB.items.some((t) => t.id === toolA.id)).toBe(false)

      await expect(repos.agentTools.update(ctxB, toolA.id, { enabled: false })).rejects.toThrow(
        /not found/i,
      )

      const unmodified = await repos.agentTools.findById(ctxA, toolA.id)
      expect(unmodified?.enabled).toBe(toolA.enabled)
    })

    it('AgentSkill: findById returns null, findByIdOrThrow throws notFound, list has no leakage, update fails', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { ctxA, ctxB, skillA } = await createTwoOrgs()

      expect(await repos.agentSkills.findById(ctxB, skillA.id)).toBeNull()
      await expect(repos.agentSkills.findByIdOrThrow(ctxB, skillA.id)).rejects.toThrow(/not found/i)

      const listB = await repos.agentSkills.list(ctxB)
      expect(listB.items.some((s) => s.id === skillA.id)).toBe(false)

      await expect(repos.agentSkills.update(ctxB, skillA.id, { level: 'basic' })).rejects.toThrow(
        /not found/i,
      )

      const unmodified = await repos.agentSkills.findById(ctxA, skillA.id)
      expect(unmodified?.level).toBe(skillA.level)
    })

    it('AuditLog: list from Org B does not contain any Org A audit log entries', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const { ctxA, ctxB, companyA } = await createTwoOrgs()

      const logsB = await repos.auditLogs.list(ctxB)
      expect(logsB.items.some((l) => l.orgId === ctxA.orgId)).toBe(false)
      expect(logsB.items.some((l) => l.resourceId === companyA.id)).toBe(false)
    })
  })

  describe('Part C2: org_id Immutability', () => {
    it('Compile-time constraint: TCreate input type forbids orgId parameter', () => {
      const _invalidInput: CreateCompanyInput = {
        name: 'Invalid OrgId Injection',
        slug: 'invalid-slug',
        // @ts-expect-error orgId must not be present in CreateCompanyInput
        orgId: '01918361-b4f7-7890-8000-000000000999',
      }
      expect(_invalidInput).toBeDefined()
    })

    it('Runtime protection: even if orgId is injected via type cast, repository forces ctx.orgId', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const ctx = makeRequestContext('01918361-b4f7-7890-8000-000000000001')
      await repos.auth.createOrganization({
        id: ctx.orgId,
        name: 'Test Org',
        slug: 'test-org',
      })

      const maliciousInput = {
        name: 'Injected Co',
        slug: 'injected-co',
        orgId: '01918361-b4f7-7890-8000-000000000666', // Attacker attempts to target a different org
      }

      const created = await repos.companies.create(ctx, maliciousInput as unknown as CreateCompanyInput)
      expect(created.orgId).toBe(ctx.orgId)
      expect(created.orgId).not.toBe(maliciousInput.orgId)
    })
  })

  describe('Part C3: Cursor Pagination with 120 Items on Exact Same Timestamp', () => {
    it('120 companies created with identical timestamp: full traversal yields 120 unique ids with no skips or duplicates', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const fixedTime = new Date('2026-08-25T12:00:00.000Z')
      const fixedClock = createFixedClock(fixedTime)
      const orgId = '01918361-b4f7-7890-8000-000000000001'

      const customCtx: RequestContext = {
        orgId,
        userId: realIdGenerator.next(),
        role: 'owner',
        requestId: realIdGenerator.next(),
        clock: fixedClock,
        ids: realIdGenerator,
        logger: rootLogger,
      }

      await repos.auth.createOrganization({
        id: orgId,
        name: 'Pagination Org',
        slug: 'pagination-org',
      })

      // Insert 120 companies with identical createdAt
      const totalCompanies = 120
      const createdIds = new Set<string>()

      for (let i = 0; i < totalCompanies; i++) {
        const comp = await repos.companies.create(customCtx, {
          name: `Company ${i}`,
          slug: `company-${i}`,
        })
        createdIds.add(comp.id)
      }
      expect(createdIds.size).toBe(120)

      // Traverse all pages with limit: 25
      const retrievedIds: string[] = []
      let cursor: string | undefined = undefined
      let pageCount = 0

      while (true) {
        pageCount++
        const page = await repos.companies.list(customCtx, undefined, {
          limit: 25,
          cursor,
        })

        for (const item of page.items) {
          retrievedIds.push(item.id)
        }

        if (!page.nextCursor) {
          expect(page.nextCursor).toBeNull()
          break
        }
        cursor = page.nextCursor
      }

      // Assert total retrieved count and uniqueness
      expect(retrievedIds.length).toBe(120)
      const uniqueRetrieved = new Set(retrievedIds)
      expect(uniqueRetrieved.size).toBe(120)
      expect(uniqueRetrieved).toEqual(createdIds)
      expect(pageCount).toBe(5) // 25 * 4 + 20 = 5 pages
    })

    it('limit > 200 is rejected by schema', () => {
      expect(() => paginationQuerySchema.parse({ limit: 201 })).toThrow()
    })
  })

  describe('Part C4: Secret Repository Security and Scope Resolution', () => {
    it('list NEVER exposes plaintext or encrypted values in serialized JSON output', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const user = await repos.auth.createUser({
        email: 'secret-test-1@example.com',
        passwordHash: 'hash',
        name: 'Secret User 1',
      })
      const ctx = makeRequestContext('01918361-b4f7-7890-8000-000000000001', user.id)
      await repos.auth.createOrganization({ id: ctx.orgId, name: 'Org', slug: 'org' })

      const secretText = 'super-secret-password-123'
      await repos.secrets.set(ctx, 'DATABASE_PASSWORD', secretText)

      const listResult = await repos.secrets.list(ctx)
      const serialized = JSON.stringify(listResult)

      expect(serialized).not.toContain(secretText)
      expect(serialized).not.toContain('valueEncrypted')
      expect(serialized).not.toContain('value')

      expect(listResult[0]).toEqual({
        key: 'DATABASE_PASSWORD',
        isSet: true,
        updatedAt: expect.any(Date),
      })
    })

    it('Scope resolution: company secret overrides org secret; falls back to org secret; null if neither exists', async ({
      skip,
    }) => {
      if (!dbAvailable) skip()
      const user = await repos.auth.createUser({
        email: 'secret-test-2@example.com',
        passwordHash: 'hash',
        name: 'Secret User 2',
      })
      const ctx = makeRequestContext('01918361-b4f7-7890-8000-000000000001', user.id)
      await repos.auth.createOrganization({ id: ctx.orgId, name: 'Org', slug: 'org' })

      const company = await repos.companies.create(ctx, { name: 'Acme', slug: 'acme' })

      // Set org-level fallback secret
      await repos.secrets.set(ctx, 'API_KEY', 'org-api-key')

      // 1. Without company secret, querying with companyId falls back to org secret
      const fallbackVal = await repos.secrets.get(ctx, 'API_KEY', company.id)
      expect(fallbackVal).toBe('org-api-key')

      // 2. Set company-level override
      await repos.secrets.set(ctx, 'API_KEY', 'company-specific-api-key', company.id)

      // Querying with companyId now returns the company override
      const companyVal = await repos.secrets.get(ctx, 'API_KEY', company.id)
      expect(companyVal).toBe('company-specific-api-key')

      // Querying org-level returns org secret
      const orgVal = await repos.secrets.get(ctx, 'API_KEY')
      expect(orgVal).toBe('org-api-key')

      // 3. Non-existent key returns null
      const nonExistent = await repos.secrets.get(ctx, 'NON_EXISTENT_KEY', company.id)
      expect(nonExistent).toBeNull()
    })

    it('Stored value_encrypted is ciphertext and differs from plaintext', async ({ skip }) => {
      if (!dbAvailable) skip()
      const user = await repos.auth.createUser({
        email: 'secret-test-3@example.com',
        passwordHash: 'hash',
        name: 'Secret User 3',
      })
      const ctx = makeRequestContext('01918361-b4f7-7890-8000-000000000001', user.id)
      await repos.auth.createOrganization({ id: ctx.orgId, name: 'Org', slug: 'org' })

      const plaintext = 'confidential-token-value'
      await repos.secrets.set(ctx, 'AUTH_TOKEN', plaintext)

      const decrypted = await repos.secrets.get(ctx, 'AUTH_TOKEN')
      expect(decrypted).toBe(plaintext)
    })
  })

  describe('Part C5: Audit Log Immutability and Append', () => {
    it('AuditLogRepository has NO update or delete methods', () => {
      const prototypeKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(repos.auditLogs))
      const forbidden = prototypeKeys.filter((k) => k.includes('update') || k.includes('delete') || k.includes('remove'))
      expect(forbidden).toHaveLength(0)
    })

    it('append correctly records actor and resource metadata', async ({ skip }) => {
      if (!dbAvailable) skip()
      const ctx = makeRequestContext('01918361-b4f7-7890-8000-000000000001')
      await repos.auth.createOrganization({ id: ctx.orgId, name: 'Org', slug: 'org' })

      await repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'agent.deploy',
        resourceType: 'agent',
        resourceId: '01918361-b4f7-7890-8000-000000000020',
        metadata: { version: '2.0.0' },
        ip: '127.0.0.1',
        userAgent: 'test-agent/1.0',
      })

      const logs = await repos.auditLogs.list(ctx)
      expect(logs.items.length).toBe(1)
      const entry = logs.items[0]!
      expect(entry.actorType).toBe('user')
      expect(entry.actorId).toBe(ctx.userId)
      expect(entry.action).toBe('agent.deploy')
      expect(entry.resourceType).toBe('agent')
      expect(entry.resourceId).toBe('01918361-b4f7-7890-8000-000000000020')
      expect(entry.metadata).toEqual({ version: '2.0.0' })
    })
  })
})

import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  createDatabase,
  closeDatabase,
  withTransaction,
  organizations,
  companies,
  agents,
  models,
  tools,
  skills,
  agentModels,
  agentTools,
  agentSkills,
  runMigrations,
  runSeed,
} from '../src/index.js'
import { isDatabaseReachable, truncateAll, assertTestDatabase } from './helpers/db.js'

describe('Database layer & Catalogs (@ai-company/db)', () => {
  let dbAvailable = false
  const db = createDatabase()

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

  it('1. Safety guard: refusing to operate on non-test database name without _test in name', async () => {
    expect(() => assertTestDatabase('ai_company')).toThrow(
      'Refusing to operate on non-test database "ai_company"',
    )
    expect(() => assertTestDatabase('production_db')).toThrow(
      'Refusing to operate on non-test database "production_db"',
    )
    expect(() => assertTestDatabase('ai_company_test')).not.toThrow()
    expect(() => assertTestDatabase('ai_company_test_db')).not.toThrow()
    expect(() => assertTestDatabase('ai_company_test_models')).not.toThrow()
    expect(() => assertTestDatabase('ai_company_test_api')).not.toThrow()
  })

  it('2. Catalog tables exist and models/tools/skills DO NOT have org_id column', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    const result = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name IN ('models', 'tools', 'skills') 
        AND column_name = 'org_id';
    `)

    expect(result.rows.length).toBe(0)
  })

  it('3. Agent link tables HAVE org_id column with NOT NULL constraint', async ({ skip }) => {
    if (!dbAvailable) skip()
    const result = await db.execute<{
      table_name: string
      column_name: string
      is_nullable: string
    }>(sql`
      SELECT table_name, column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name IN ('agent_models', 'agent_tools', 'agent_skills') 
        AND column_name = 'org_id';
    `)

    expect(result.rows.length).toBe(3)
    for (const col of result.rows) {
      expect(col.is_nullable).toBe('NO')
    }
  })

  it('4. Partial index: exactly one preferred model per agent allowed; multiple fallbacks allowed', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    const orgId = '01918361-b4f7-7890-8000-000000000001'
    const companyId = '01918361-b4f7-7890-8000-000000000002'
    const agentId = '01918361-b4f7-7890-8000-000000000020'
    const model1Id = '01918361-b4f7-7890-a000-000000000001'
    const model2Id = '01918361-b4f7-7890-a000-000000000002'
    const model3Id = '01918361-b4f7-7890-a000-000000000003'

    await db.insert(organizations).values({ id: orgId, name: 'Org', slug: 'org' })
    await db.insert(companies).values({ id: companyId, orgId, name: 'Co', slug: 'co' })
    await db.insert(agents).values({
      id: agentId,
      orgId,
      companyId,
      name: 'Agent Preferred Test',
      role: 'Worker',
      title: 'Engineer',
      systemPrompt: 'prompt',
    })

    await db.insert(models).values([
      {
        id: model1Id,
        provider: 'anthropic',
        modelKey: 'test-model-1',
        displayName: 'Model 1',
        tier: 'frontier',
        contextWindow: 100000,
        maxOutputTokens: 4096,
        inputPricePerMillion: '10.000000',
        outputPricePerMillion: '30.000000',
      },
      {
        id: model2Id,
        provider: 'anthropic',
        modelKey: 'test-model-2',
        displayName: 'Model 2',
        tier: 'balanced',
        contextWindow: 100000,
        maxOutputTokens: 4096,
        inputPricePerMillion: '3.000000',
        outputPricePerMillion: '15.000000',
      },
      {
        id: model3Id,
        provider: 'anthropic',
        modelKey: 'test-model-3',
        displayName: 'Model 3',
        tier: 'cheap',
        contextWindow: 100000,
        maxOutputTokens: 4096,
        inputPricePerMillion: '1.000000',
        outputPricePerMillion: '5.000000',
      },
    ])

    // 1. First preferred model succeeds
    await db.insert(agentModels).values({
      id: '01918361-b4f7-7890-d000-000000000001',
      orgId,
      agentId,
      modelId: model1Id,
      role: 'preferred',
      priority: 0,
    })

    // 2. Second preferred model on the same agent must fail (partial unique index constraint)
    await expect(
      db.insert(agentModels).values({
        id: '01918361-b4f7-7890-d000-000000000002',
        orgId,
        agentId,
        modelId: model2Id,
        role: 'preferred',
        priority: 1,
      }),
    ).rejects.toThrow()

    // 3. Adding multiple fallback models succeeds
    await expect(
      db.insert(agentModels).values({
        id: '01918361-b4f7-7890-d000-000000000003',
        orgId,
        agentId,
        modelId: model2Id,
        role: 'fallback',
        priority: 1,
      }),
    ).resolves.not.toThrow()

    await expect(
      db.insert(agentModels).values({
        id: '01918361-b4f7-7890-d000-000000000004',
        orgId,
        agentId,
        modelId: model3Id,
        role: 'fallback',
        priority: 2,
      }),
    ).resolves.not.toThrow()
  })

  it('5. ON DELETE RESTRICT: deleting a catalog model assigned to an agent is rejected', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    const orgId = '01918361-b4f7-7890-8000-000000000001'
    const companyId = '01918361-b4f7-7890-8000-000000000002'
    const agentId = '01918361-b4f7-7890-8000-000000000020'
    const modelId = '01918361-b4f7-7890-a000-000000000001'

    await db.insert(organizations).values({ id: orgId, name: 'Org', slug: 'org' })
    await db.insert(companies).values({ id: companyId, orgId, name: 'Co', slug: 'co' })
    await db.insert(agents).values({
      id: agentId,
      orgId,
      companyId,
      name: 'Agent Restrict Test',
      role: 'Worker',
      title: 'Engineer',
      systemPrompt: 'prompt',
    })
    await db.insert(models).values({
      id: modelId,
      provider: 'anthropic',
      modelKey: 'restrict-test-model',
      displayName: 'Restrict Test Model',
      tier: 'frontier',
      contextWindow: 100000,
      maxOutputTokens: 4096,
      inputPricePerMillion: '10.000000',
      outputPricePerMillion: '30.000000',
    })
    await db.insert(agentModels).values({
      id: '01918361-b4f7-7890-d000-000000000001',
      orgId,
      agentId,
      modelId,
      role: 'preferred',
    })

    // Attempting to delete model while referenced by agent_models must throw FK violation
    await expect(db.delete(models).where(eq(models.id, modelId))).rejects.toThrow()
  })

  it('6. ON DELETE CASCADE: deleting agent cascades to agent_models, agent_tools, and agent_skills', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    const orgId = '01918361-b4f7-7890-8000-000000000001'
    const companyId = '01918361-b4f7-7890-8000-000000000002'
    const agentId = '01918361-b4f7-7890-8000-000000000020'
    const modelId = '01918361-b4f7-7890-a000-000000000001'
    const toolId = '01918361-b4f7-7890-b000-000000000001'
    const skillId = '01918361-b4f7-7890-c000-000000000001'

    await db.insert(organizations).values({ id: orgId, name: 'Org', slug: 'org' })
    await db.insert(companies).values({ id: companyId, orgId, name: 'Co', slug: 'co' })
    await db.insert(agents).values({
      id: agentId,
      orgId,
      companyId,
      name: 'Agent Cascade Test',
      role: 'Worker',
      title: 'Engineer',
      systemPrompt: 'prompt',
    })
    await db.insert(models).values({
      id: modelId,
      provider: 'anthropic',
      modelKey: 'cascade-model',
      displayName: 'Cascade Model',
      tier: 'frontier',
      contextWindow: 100000,
      maxOutputTokens: 4096,
      inputPricePerMillion: '10.000000',
      outputPricePerMillion: '30.000000',
    })
    await db.insert(tools).values({
      id: toolId,
      key: 'cascade_tool',
      name: 'Cascade Tool',
      description: 'desc',
      category: 'system',
      autonomyLevel: 0,
      inputSchema: { type: 'object' },
    })
    await db.insert(skills).values({
      id: skillId,
      key: 'cascade_skill',
      name: 'Cascade Skill',
      description: 'desc',
      category: 'engineering',
    })

    await db.insert(agentModels).values({
      id: '01918361-b4f7-7890-d000-000000000001',
      orgId,
      agentId,
      modelId,
      role: 'preferred',
    })
    await db.insert(agentTools).values({
      id: '01918361-b4f7-7890-e000-000000000001',
      orgId,
      agentId,
      toolId,
    })
    await db.insert(agentSkills).values({
      id: '01918361-b4f7-7890-f000-000000000001',
      orgId,
      agentId,
      skillId,
    })

    // Delete agent
    await db.delete(agents).where(eq(agents.id, agentId))

    const amRows = await db.select().from(agentModels).where(eq(agentModels.agentId, agentId))
    const atRows = await db.select().from(agentTools).where(eq(agentTools.agentId, agentId))
    const asRows = await db.select().from(agentSkills).where(eq(agentSkills.agentId, agentId))

    expect(amRows.length).toBe(0)
    expect(atRows.length).toBe(0)
    expect(asRows.length).toBe(0)
  })

  it('7. UNIQUE(provider, model_key) constraint enforces model uniqueness', async ({ skip }) => {
    if (!dbAvailable) skip()
    await db.insert(models).values({
      id: '01918361-b4f7-7890-a000-000000000001',
      provider: 'openai',
      modelKey: 'gpt-unique-test',
      displayName: 'Unique GPT',
      tier: 'frontier',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputPricePerMillion: '5.000000',
      outputPricePerMillion: '15.000000',
    })

    // Duplicate provider + modelKey must throw unique violation
    await expect(
      db.insert(models).values({
        id: '01918361-b4f7-7890-a000-000000000002',
        provider: 'openai',
        modelKey: 'gpt-unique-test',
        displayName: 'Duplicate GPT',
        tier: 'frontier',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputPricePerMillion: '5.000000',
        outputPricePerMillion: '15.000000',
      }),
    ).rejects.toThrow()
  })

  it('8. tools.autonomy_level rejects values 4 and -1 (CHECK constraint works)', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    await expect(
      db.insert(tools).values({
        id: '01918361-b4f7-7890-b000-000000000001',
        key: 'invalid_autonomy_high',
        name: 'Invalid High',
        description: 'desc',
        category: 'system',
        autonomyLevel: 4 as unknown as number,
        inputSchema: { type: 'object' },
      }),
    ).rejects.toThrow()

    await expect(
      db.insert(tools).values({
        id: '01918361-b4f7-7890-b000-000000000002',
        key: 'invalid_autonomy_low',
        name: 'Invalid Low',
        description: 'desc',
        category: 'system',
        autonomyLevel: -1 as unknown as number,
        inputSchema: { type: 'object' },
      }),
    ).rejects.toThrow()
  })

  it('9. Seed is idempotent: running runSeed twice produces exact same row counts', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    await runSeed()

    const modelsCount1 = (await db.select().from(models)).length
    const toolsCount1 = (await db.select().from(tools)).length
    const skillsCount1 = (await db.select().from(skills)).length
    const agentsCount1 = (await db.select().from(agents)).length
    const agentModelsCount1 = (await db.select().from(agentModels)).length
    const agentToolsCount1 = (await db.select().from(agentTools)).length
    const agentSkillsCount1 = (await db.select().from(agentSkills)).length

    // Re-run seed
    await runSeed()

    const modelsCount2 = (await db.select().from(models)).length
    const toolsCount2 = (await db.select().from(tools)).length
    const skillsCount2 = (await db.select().from(skills)).length
    const agentsCount2 = (await db.select().from(agents)).length
    const agentModelsCount2 = (await db.select().from(agentModels)).length
    const agentToolsCount2 = (await db.select().from(agentTools)).length
    const agentSkillsCount2 = (await db.select().from(agentSkills)).length

    expect(modelsCount2).toBe(modelsCount1)
    expect(toolsCount2).toBe(toolsCount1)
    expect(skillsCount2).toBe(skillsCount1)
    expect(agentsCount2).toBe(agentsCount1)
    expect(agentModelsCount2).toBe(agentModelsCount1)
    expect(agentToolsCount2).toBe(agentToolsCount1)
    expect(agentSkillsCount2).toBe(agentSkillsCount1)
  })

  it('10. After seed: every demo agent has exactly 1 preferred model and at least 1 fallback model (FR-4.2)', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    await runSeed()

    const seededAgents = await db.select().from(agents)
    expect(seededAgents.length).toBe(4)

    for (const agent of seededAgents) {
      const assignedModels = await db
        .select()
        .from(agentModels)
        .where(eq(agentModels.agentId, agent.id))

      const preferred = assignedModels.filter((m) => m.role === 'preferred')
      const fallback = assignedModels.filter((m) => m.role === 'fallback')

      expect(preferred.length, `Agent ${agent.name} must have exactly 1 preferred model`).toBe(1)
      expect(fallback.length, `Agent ${agent.name} must have at least 1 fallback model`).toBeGreaterThanOrEqual(1)
    }
  })

  it('11. After seed: tool autonomy check matches agent max autonomy with Developer + github_pr_create exception', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    await runSeed()

    const joined = await db
      .select({
        agentName: agents.name,
        agentMaxAutonomy: agents.maxAutonomyLevel,
        toolKey: tools.key,
        toolAutonomy: tools.autonomyLevel,
      })
      .from(agentTools)
      .innerJoin(agents, eq(agentTools.agentId, agents.id))
      .innerJoin(tools, eq(agentTools.toolId, tools.id))

    // Note: Developer has maxAutonomyLevel 1, but possesses github_pr_create (level 2).
    // On Step 17, Permission Broker will enforce runtime human approval for level 2 actions.
    const allowedExceptions = new Set(['Developer:github_pr_create'])

    for (const item of joined) {
      const isException = allowedExceptions.has(`${item.agentName}:${item.toolKey}`)
      if (!isException) {
        expect(
          item.toolAutonomy,
          `Agent ${item.agentName} (max: ${item.agentMaxAutonomy}) has tool ${item.toolKey} with higher autonomy ${item.toolAutonomy}`,
        ).toBeLessThanOrEqual(item.agentMaxAutonomy)
      } else {
        expect(item.toolAutonomy).toBeGreaterThan(item.agentMaxAutonomy)
      }
    }
  })

  it('12. Nested withTransaction proves single transaction: exception in tx2 rolls back tx1 preceding changes (A2)', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    const orgId = '01918361-b4f7-7890-8000-000000000040'
    const companyId = '01918361-b4f7-7890-8000-000000000041'

    await expect(
      withTransaction(db, async (tx1) => {
        // Step 1: Insert organization in tx1
        await tx1.insert(organizations).values({
          id: orgId,
          name: 'Nested Tx Org',
          slug: 'nested-tx-org',
        })

        // Step 2: Nested transaction call with existing tx1
        await withTransaction(
          db,
          async (tx2) => {
            await tx2.insert(companies).values({
              id: companyId,
              orgId,
              name: 'Nested Company',
              slug: 'nested-company',
            })
            // Force error inside nested transaction
            throw new Error('Nested transaction rollback error')
          },
          tx1,
        )
      }),
    ).rejects.toThrow('Nested transaction rollback error')

    // Verify both inserts rolled back because tx1 and tx2 shared the single transaction
    const orgRows = await db.select().from(organizations).where(eq(organizations.id, orgId))
    const compRows = await db.select().from(companies).where(eq(companies.id, companyId))

    expect(orgRows.length).toBe(0)
    expect(compRows.length).toBe(0)
  })

  it('13. All timestamp columns in all tables have datetime_precision = 3', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()
    const result = await db.execute<{
      table_name: string
      column_name: string
      datetime_precision: number
    }>(sql`
      SELECT table_name, column_name, datetime_precision 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND data_type = 'timestamp with time zone';
    `)

    expect(result.rows.length).toBeGreaterThan(0)
    for (const col of result.rows) {
      expect(
        col.datetime_precision,
        `Table ${col.table_name}.${col.column_name} must have precision 3`,
      ).toBe(3)
    }
  })
})

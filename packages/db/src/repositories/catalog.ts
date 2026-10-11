import { eq, and, lte, inArray } from 'drizzle-orm'
import type { Database, Tx } from '../client.js'
import {
  models,
  tools,
  skills,
  type Model,
  type Tool,
  type Skill,
} from '../schema/catalog.js'
import type { DbOrTx } from './types.js'

export interface ModelFilter {
  provider?: ('openai' | 'anthropic' | 'google') | undefined
  tier?: ('frontier' | 'balanced' | 'cheap') | undefined
  status?: ('active' | 'deprecated') | undefined
  pricingVerified?: boolean | undefined
}

export interface ToolFilter {
  category?:
    | ('research' | 'development' | 'communication' | 'data' | 'finance' | 'system')
    | undefined
  maxAutonomyLevel?: number | undefined
  status?: ('active' | 'disabled') | undefined
}

export interface SkillFilter {
  category?:
    | ('engineering' | 'marketing' | 'finance' | 'research' | 'operations' | 'legal')
    | undefined
  status?: ('active' | 'disabled') | undefined
}

export class CatalogRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async listModels(filter?: ModelFilter, tx?: Tx): Promise<Model[]> {
    const executor = this.getExecutor(tx)
    const conditions = []

    if (filter?.provider) {
      conditions.push(eq(models.provider, filter.provider))
    }
    if (filter?.tier) {
      conditions.push(eq(models.tier, filter.tier))
    }
    if (filter?.status) {
      conditions.push(eq(models.status, filter.status))
    }
    if (filter?.pricingVerified !== undefined) {
      conditions.push(eq(models.pricingVerified, filter.pricingVerified))
    }

    if (conditions.length === 0) {
      return executor.select().from(models)
    }

    return executor
      .select()
      .from(models)
      .where(and(...conditions))
  }

  async findModelById(id: string, tx?: Tx): Promise<Model | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(models)
      .where(eq(models.id, id))
      .limit(1)

    return row ?? null
  }

  async findModelsByIds(ids: string[], tx?: Tx): Promise<Model[]> {
    if (ids.length === 0) return []
    const executor = this.getExecutor(tx)
    return executor.select().from(models).where(inArray(models.id, ids))
  }

  async findModelByKey(
    provider: 'openai' | 'anthropic' | 'google',
    modelKey: string,
    tx?: Tx,
  ): Promise<Model | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(models)
      .where(and(eq(models.provider, provider), eq(models.modelKey, modelKey)))
      .limit(1)

    return row ?? null
  }

  async findModelByModelKey(modelKey: string, tx?: Tx): Promise<Model | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(models)
      .where(eq(models.modelKey, modelKey))
      .limit(1)

    return row ?? null
  }

  async listTools(filter?: ToolFilter, tx?: Tx): Promise<Tool[]> {
    const executor = this.getExecutor(tx)
    const conditions = []

    if (filter?.category) {
      conditions.push(eq(tools.category, filter.category))
    }
    if (filter?.maxAutonomyLevel !== undefined) {
      conditions.push(lte(tools.autonomyLevel, filter.maxAutonomyLevel))
    }
    if (filter?.status) {
      conditions.push(eq(tools.status, filter.status))
    }

    if (conditions.length === 0) {
      return executor.select().from(tools)
    }

    return executor
      .select()
      .from(tools)
      .where(and(...conditions))
  }

  async findToolById(id: string, tx?: Tx): Promise<Tool | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(tools)
      .where(eq(tools.id, id))
      .limit(1)

    return row ?? null
  }

  async findToolByKey(key: string, tx?: Tx): Promise<Tool | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(tools)
      .where(eq(tools.key, key))
      .limit(1)

    return row ?? null
  }

  async findToolsByIds(ids: string[], tx?: Tx): Promise<Tool[]> {
    if (ids.length === 0) return []
    const executor = this.getExecutor(tx)
    return executor.select().from(tools).where(inArray(tools.id, ids))
  }

  async listSkills(filter?: SkillFilter, tx?: Tx): Promise<Skill[]> {
    const executor = this.getExecutor(tx)
    const conditions = []

    if (filter?.category) {
      conditions.push(eq(skills.category, filter.category))
    }
    if (filter?.status) {
      conditions.push(eq(skills.status, filter.status))
    }

    if (conditions.length === 0) {
      return executor.select().from(skills)
    }

    return executor
      .select()
      .from(skills)
      .where(and(...conditions))
  }

  async findSkillById(id: string, tx?: Tx): Promise<Skill | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(skills)
      .where(eq(skills.id, id))
      .limit(1)

    return row ?? null
  }

  async findSkillByKey(key: string, tx?: Tx): Promise<Skill | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(skills)
      .where(eq(skills.key, key))
      .limit(1)

    return row ?? null
  }

  async findSkillsByIds(ids: string[], tx?: Tx): Promise<Skill[]> {
    if (ids.length === 0) return []
    const executor = this.getExecutor(tx)
    return executor.select().from(skills).where(inArray(skills.id, ids))
  }
}

import type { Database, Repositories } from '@ai-company/db'
import { createDatabase, createRepositories } from '@ai-company/db'
import type { Clock, IdGenerator, Logger } from '@ai-company/shared'
import { systemClock, realIdGenerator, rootLogger, env } from '@ai-company/shared'
import {
  type ProviderRegistry,
  createProviderRegistry,
  createAnthropicProvider,
} from '@ai-company/models'

export interface AppDeps {
  db: Database
  repos: Repositories
  clock: Clock
  ids: IdGenerator
  logger: Logger
  registry?: ProviderRegistry
}

export function createAppDeps(overrides?: Partial<AppDeps>): AppDeps {
  const clock = overrides?.clock ?? systemClock
  const ids = overrides?.ids ?? realIdGenerator
  const logger = overrides?.logger ?? rootLogger
  const db = overrides?.db ?? createDatabase()
  const repos = overrides?.repos ?? createRepositories(db, { clock, ids })

  const registry = overrides?.registry ?? createProviderRegistry()
  if (!overrides?.registry) {
    const apiKey = env.ANTHROPIC_API_KEY
    if (apiKey) {
      registry.register(createAnthropicProvider({ apiKey, maxRetries: 0 }, logger))
    }
  }

  return {
    db,
    repos,
    clock,
    ids,
    logger,
    registry,
  }
}


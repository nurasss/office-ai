import type { FastifyPluginAsync } from 'fastify'
import { z } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'

const listModelsQuerySchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google']).optional(),
  tier: z.enum(['frontier', 'balanced', 'cheap']).optional(),
  status: z.enum(['active', 'deprecated']).optional(),
})

const listToolsQuerySchema = z.object({
  category: z
    .enum(['research', 'development', 'communication', 'data', 'finance', 'system'])
    .optional(),
  maxAutonomyLevel: z.coerce.number().int().min(0).max(3).optional(),
})

const listSkillsQuerySchema = z.object({
  category: z
    .enum(['engineering', 'marketing', 'finance', 'research', 'operations', 'legal'])
    .optional(),
})

export interface CatalogRouteOptions {
  deps: AppDeps
}

export const catalogRoute: FastifyPluginAsync<CatalogRouteOptions> = async (fastify, opts) => {
  const { deps } = opts

  fastify.get(
    '/v1/catalog/models',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      const query = listModelsQuerySchema.parse(req.query)
      const list = await deps.repos.catalog.listModels({
        provider: query.provider,
        tier: query.tier,
        status: query.status,
      })
      return reply.status(200).send({ items: list })
    },
  )

  fastify.get(
    '/v1/catalog/tools',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      const query = listToolsQuerySchema.parse(req.query)
      const list = await deps.repos.catalog.listTools({
        category: query.category,
        maxAutonomyLevel: query.maxAutonomyLevel,
      })
      return reply.status(200).send({ items: list })
    },
  )

  fastify.get(
    '/v1/catalog/skills',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      const query = listSkillsQuerySchema.parse(req.query)
      const list = await deps.repos.catalog.listSkills({
        category: query.category,
      })
      return reply.status(200).send({ items: list })
    },
  )
}

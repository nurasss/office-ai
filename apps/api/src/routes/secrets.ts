import type { FastifyPluginAsync } from 'fastify'
import { z, assertRole } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'
import { SecretService } from '../services/secret-service.js'

const listSecretsQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
})

const secretParamsSchema = z.object({
  key: z.string().min(1),
})

const setSecretBodySchema = z.object({
  value: z.string().min(1).max(8192),
  companyId: z.string().uuid().optional(),
})

const deleteSecretQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
})

export interface SecretsRouteOptions {
  deps: AppDeps
}

export const secretsRoute: FastifyPluginAsync<SecretsRouteOptions> = async (fastify, opts) => {
  const { deps } = opts
  const secretService = new SecretService(deps)

  fastify.get('/v1/secrets', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin'])
    const query = listSecretsQuerySchema.parse(req.query)
    const list = await secretService.list(req.ctx!, query.companyId)
    return reply.status(200).send({ items: list })
  })

  fastify.put('/v1/secrets/:key', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin'])
    const params = secretParamsSchema.parse(req.params)
    const body = setSecretBodySchema.parse(req.body)
    await secretService.set(req.ctx!, params.key, body.value, body.companyId)
    return reply.status(200).send({ success: true, key: params.key })
  })

  fastify.delete(
    '/v1/secrets/:key',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin'])
      const params = secretParamsSchema.parse(req.params)
      const query = deleteSecretQuerySchema.parse(req.query)
      await secretService.remove(req.ctx!, params.key, query.companyId)
      return reply.status(200).send({ success: true, key: params.key })
    },
  )
}

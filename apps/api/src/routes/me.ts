import type { FastifyPluginAsync } from 'fastify'
import type { AppDeps } from '../deps.js'
import { AuthService } from '../services/auth-service.js'

export interface MeRoutesOptions {
  deps: AppDeps
}

export const meRoutes: FastifyPluginAsync<MeRoutesOptions> = async (fastify, opts) => {
  const { deps } = opts
  const authService = new AuthService(deps)

  fastify.get(
    '/v1/me',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      const result = await authService.getMe(req.ctx!.userId, req.ctx!.orgId)
      return reply.status(200).send(result)
    },
  )
}

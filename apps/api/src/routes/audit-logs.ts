import type { FastifyPluginAsync } from 'fastify'
import { z, assertRole, paginationQuerySchema } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'

const listAuditLogsQuerySchema = z.object({
  actorType: z.enum(['user', 'agent', 'system']).optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export interface AuditLogsRouteOptions {
  deps: AppDeps
}

export const auditLogsRoute: FastifyPluginAsync<AuditLogsRouteOptions> = async (fastify, opts) => {
  const { deps } = opts

  fastify.get('/v1/audit-logs', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin'])
    const query = listAuditLogsQuerySchema.parse(req.query)
    const pagination = paginationQuerySchema.parse({
      cursor: query.cursor,
      limit: query.limit,
    })
    const page = await deps.repos.auditLogs.list(
      req.ctx!,
      {
        actorType: query.actorType,
        actorId: query.actorId,
        action: query.action,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
      },
      pagination,
    )
    return reply.status(200).send(page)
  })
}

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { RequestContext } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string
    startTime: number
    ctx?: RequestContext
  }
}

export interface RequestContextPluginOptions {
  deps: AppDeps
}

const requestContextPluginCallback: FastifyPluginAsync<RequestContextPluginOptions> = async (
  fastify,
  opts,
) => {
  const { deps } = opts

  fastify.addHook('onRequest', async (req, reply) => {
    const existingId = req.headers['x-request-id']
    const requestId =
      typeof existingId === 'string' && existingId.length > 0
        ? existingId
        : deps.ids.next()

    req.requestId = requestId
    req.startTime = deps.clock.now().getTime()
    reply.header('x-request-id', requestId)

    deps.logger.info({
      msg: 'Incoming request',
      requestId,
      method: req.method,
      url: req.url,
      ip: req.ip,
    })
  })

  fastify.addHook('onResponse', async (req, reply) => {
    const durationMs = deps.clock.now().getTime() - (req.startTime || 0)
    const logData: Record<string, unknown> = {
      msg: 'Request completed',
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs,
    }

    if (req.ctx) {
      logData['orgId'] = req.ctx.orgId
      logData['userId'] = req.ctx.userId
    }

    deps.logger.info(logData)
  })
}

export const requestContextPlugin = fp(requestContextPluginCallback, {
  name: 'request-context-plugin',
})

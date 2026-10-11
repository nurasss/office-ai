import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import { ERROR_CODES } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'

export interface RateLimitPluginOptions {
  deps: AppDeps
}

const rateLimitPluginCallback: FastifyPluginAsync<RateLimitPluginOptions> = async (
  fastify,
  opts,
) => {
  const { deps } = opts

  await fastify.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: 60 * 1000,
    errorResponseBuilder: (req, context) => {
      const retryAfterSec = Math.ceil(context.ttl / 1000)
      return {
        error: {
          code: ERROR_CODES.RATE_LIMITED,
          message: `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`,
          details: { retryAfterSec },
          requestId: req.requestId || deps.ids.next(),
        },
      }
    },
  })
}

export const rateLimitPlugin = fp(rateLimitPluginCallback, {
  name: 'rate-limit-plugin',
})

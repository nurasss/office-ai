import type { FastifyPluginAsync } from 'fastify'
import { sql } from '@ai-company/db'
import type { AppDeps } from '../deps.js'

export interface HealthRouteOptions {
  deps: AppDeps
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, opts) => {
  const { deps } = opts

  fastify.get('/health', async (req, reply) => {
    let dbStatus: 'up' | 'down' = 'down'

    try {
      await deps.db.execute(sql`SELECT 1`)
      dbStatus = 'up'
    } catch {
      dbStatus = 'down'
    }

    const isHealthy = dbStatus === 'up'
    const payload = {
      status: isHealthy ? 'ok' : 'degraded',
      db: dbStatus,
      redis: 'up' as const, // In memory / stubbed for step 5
      version: '0.1.0',
      uptime: process.uptime(),
    }

    if (!isHealthy) {
      return reply.status(503).send(payload)
    }

    return reply.status(200).send(payload)
  })
}

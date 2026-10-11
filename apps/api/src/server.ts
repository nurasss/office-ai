import fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { env } from '@ai-company/shared'
import type { AppDeps } from './deps.js'
import { requestContextPlugin } from './plugins/request-context.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { rateLimitPlugin } from './plugins/rate-limit.js'
import { authPlugin } from './plugins/auth.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { meRoutes } from './routes/me.js'
import { companiesRoute } from './routes/companies.js'
import { departmentsRoute } from './routes/departments.js'
import { agentsRoute } from './routes/agents.js'
import { catalogRoute } from './routes/catalog.js'
import { secretsRoute } from './routes/secrets.js'
import { auditLogsRoute } from './routes/audit-logs.js'

export function buildServer(deps: AppDeps): FastifyInstance {
  // CORS origin security check
  if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.trim() === '*') {
    throw new Error('Wildcard CORS origin (*) is strictly forbidden in production')
  }

  const server = fastify({
    bodyLimit: 1048576, // 1MB limit
    trustProxy: true,
    logger: false, // Handled via our custom Pino logger and requestContextPlugin
  })

  // 1. Security Headers
  server.register(helmet, {
    contentSecurityPolicy: false, // API server does not serve HTML
  })

  // 2. CORS
  const corsOrigins =
    env.CORS_ORIGINS.trim() === '*'
      ? '*'
      : env.CORS_ORIGINS.split(',').map((o) => o.trim())

  server.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  })

  // 3. Application Plugins
  server.register(requestContextPlugin, { deps })
  server.register(errorHandlerPlugin, { deps })
  server.register(rateLimitPlugin, { deps })
  server.register(authPlugin, { deps })

  // 4. Routes
  server.register(healthRoutes, { deps })
  server.register(authRoutes, { deps })
  server.register(meRoutes, { deps })
  server.register(companiesRoute, { deps })
  server.register(departmentsRoute, { deps })
  server.register(agentsRoute, { deps })
  server.register(catalogRoute, { deps })
  server.register(secretsRoute, { deps })
  server.register(auditLogsRoute, { deps })

  return server
}

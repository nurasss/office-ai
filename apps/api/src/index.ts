import { env } from '@ai-company/shared'
import { closeDatabase } from '@ai-company/db'
import { createAppDeps } from './deps.js'
import { buildServer } from './server.js'

async function bootstrap(): Promise<void> {
  const deps = createAppDeps()
  const server = buildServer(deps)

  // Unhandled error crash guards
  process.on('unhandledRejection', (reason) => {
    deps.logger.fatal({ msg: 'Unhandled promise rejection', err: reason })
    process.exit(1)
  })

  process.on('uncaughtException', (err) => {
    deps.logger.fatal({ msg: 'Uncaught exception', err })
    process.exit(1)
  })

  // Graceful shutdown
  let isShuttingDown = false
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    deps.logger.info({ msg: `Received ${signal}, initiating graceful shutdown...` })

    try {
      await server.close()
      await closeDatabase()
      deps.logger.info({ msg: 'Server and database connections closed successfully' })
      process.exit(0)
    } catch (err) {
      deps.logger.error({ msg: 'Error during graceful shutdown', err })
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  try {
    await server.listen({
      port: env.API_PORT,
      host: env.API_HOST,
    })
    deps.logger.info({
      msg: `🚀 AI Company OS API server listening on http://${env.API_HOST}:${env.API_PORT}`,
      env: env.NODE_ENV,
      port: env.API_PORT,
    })
  } catch (err) {
    deps.logger.fatal({ msg: 'Failed to start API server', err })
    process.exit(1)
  }
}

bootstrap().catch((err) => {
  console.error('Fatal error during startup:', err)
  process.exit(1)
})

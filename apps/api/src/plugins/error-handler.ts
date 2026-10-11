import type { FastifyPluginAsync, FastifyError } from 'fastify'
import fp from 'fastify-plugin'
import { ERROR_CODES, isAppError, validationError, ZodError } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'

export interface ErrorHandlerPluginOptions {
  deps: AppDeps
}

const errorHandlerPluginCallback: FastifyPluginAsync<ErrorHandlerPluginOptions> = async (
  fastify,
  opts,
) => {
  const { deps } = opts

  fastify.setErrorHandler((error: FastifyError | Error | Record<string, unknown>, req, reply) => {
    const requestId = req.requestId || deps.ids.next()

    // 1. Domain AppError
    if (isAppError(error)) {
      return reply.status(error.httpStatus).send(error.toResponse(requestId))
    }

    // 2. Zod validation error
    if (error instanceof ZodError) {
      const appErr = validationError(error.issues)
      return reply.status(400).send(appErr.toResponse(requestId))
    }

    // 3. Fastify rate limit error (429)
    const isRateLimitObj =
      typeof error === 'object' &&
      error !== null &&
      'error' in error &&
      typeof error.error === 'object' &&
      error.error !== null &&
      'code' in error.error &&
      error.error.code === ERROR_CODES.RATE_LIMITED

    const isRateLimitStatus = 'statusCode' in error && error.statusCode === 429
    const isRateLimitCode = 'code' in error && error.code === 'FST_ERR_RATE_LIMIT_EXCEEDED'

    if (isRateLimitObj || isRateLimitStatus || isRateLimitCode) {
      const rateLimitPayload = isRateLimitObj
        ? error
        : {
            error: {
              code: ERROR_CODES.RATE_LIMITED,
              message: 'message' in error && typeof error.message === 'string' ? error.message : 'Rate limit exceeded',
              requestId,
            },
          }
      return reply.status(429).send(rateLimitPayload)
    }

    // 4. Fastify payload too large (413)
    if ('statusCode' in error && error.statusCode === 413) {
      return reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Payload exceeds maximum allowed limit',
          requestId,
        },
      })
    }

    // 5. Fastify schema validation error
    if ('validation' in error && error.validation) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: error instanceof Error ? error.message : 'Validation failed',
          details: { validation: error.validation },
          requestId,
        },
      })
    }

    // 6. Unhandled / unexpected internal error
    deps.logger.error({
      msg: 'Unhandled internal error',
      requestId,
      err: error,
      stack: error instanceof Error ? error.stack : undefined,
      method: req.method,
      url: req.url,
    })

    // Never leak internal stack traces to the response body
    return reply.status(500).send({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
        requestId,
      },
    })
  })

  fastify.setNotFoundHandler((req, reply) => {
    const requestId = req.requestId || deps.ids.next()
    return reply.status(404).send({
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: `Route '${req.method} ${req.url}' not found`,
        requestId,
      },
    })
  })
}

export const errorHandlerPlugin = fp(errorHandlerPluginCallback, {
  name: 'error-handler-plugin',
})

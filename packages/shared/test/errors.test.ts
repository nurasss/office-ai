import { describe, expect, it } from 'vitest'
import {
  AppError,
  conflict,
  ERROR_CODES,
  forbidden,
  internal,
  isAppError,
  notFound,
  rateLimited,
  unauthorized,
  validationError,
} from '../src/index.js'

describe('errors', () => {
  it('toResponse produces { error: { code, message, requestId } }', () => {
    const err = new AppError({
      code: ERROR_CODES.NOT_FOUND,
      httpStatus: 404,
      message: 'Agent not found',
      details: { agentId: 'agent-123' },
    })

    const json = err.toResponse('req-abc-123')
    expect(json).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Agent not found',
        details: { agentId: 'agent-123' },
        requestId: 'req-abc-123',
      },
    })
  })

  it('AppError has NO toJSON method and standard JSON.stringify is NOT overridden', () => {
    const err = new AppError({
      code: ERROR_CODES.NOT_FOUND,
      httpStatus: 404,
      message: 'Resource not found',
    })

    // Verify there is no toJSON method on instance or prototype
    expect((err as unknown as Record<string, unknown>)['toJSON']).toBeUndefined()

    // JSON.stringify should not produce root { "error": ... } structure
    const stringified = JSON.stringify(err)
    expect(stringified).not.toContain('"error"')
    const parsed = JSON.parse(stringified)
    expect(parsed).not.toHaveProperty('error')
  })

  it('isAppError distinguishes AppError from regular Error', () => {
    const appErr = notFound('User', 'u-1')
    const stdErr = new Error('Some standard error')

    expect(isAppError(appErr)).toBe(true)
    expect(isAppError(stdErr)).toBe(false)
    expect(isAppError('not an error')).toBe(false)
  })

  it('factories construct expected AppErrors', () => {
    const nf = notFound('User', 'u-1')
    expect(nf.httpStatus).toBe(404)
    expect(nf.code).toBe(ERROR_CODES.NOT_FOUND)

    const unauth = unauthorized(ERROR_CODES.INVALID_CREDENTIALS)
    expect(unauth.httpStatus).toBe(401)
    expect(unauth.code).toBe(ERROR_CODES.INVALID_CREDENTIALS)

    const forb = forbidden('Insufficient permissions')
    expect(forb.httpStatus).toBe(403)
    expect(forb.code).toBe(ERROR_CODES.FORBIDDEN)

    const val = validationError({ field: 'required' })
    expect(val.httpStatus).toBe(400)
    expect(val.code).toBe(ERROR_CODES.VALIDATION_ERROR)

    const conf = conflict(ERROR_CODES.EMAIL_ALREADY_EXISTS, 'Email taken')
    expect(conf.httpStatus).toBe(409)
    expect(conf.code).toBe(ERROR_CODES.EMAIL_ALREADY_EXISTS)

    const int = internal(new Error('db down'))
    expect(int.httpStatus).toBe(500)
    expect(int.code).toBe(ERROR_CODES.INTERNAL_ERROR)

    const rl = rateLimited(60)
    expect(rl.httpStatus).toBe(429)
    expect(rl.code).toBe(ERROR_CODES.RATE_LIMITED)
    expect(rl.retryable).toBe(true)
    expect(rl.details).toEqual({ retryAfterSec: 60 })
  })
})

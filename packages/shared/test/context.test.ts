import { describe, expect, it } from 'vitest'
import {
  AppError,
  assertRole,
  createFixedClock,
  createFixedIdGenerator,
  ERROR_CODES,
  type RequestContext,
  rootLogger,
  type SystemContext,
} from '../src/index.js'

describe('context and assertRole', () => {
  const clock = createFixedClock(new Date())
  const ids = createFixedIdGenerator(['id-1'])
  const logger = rootLogger

  it('assertRole allows owner when allowed is ["owner", "admin"]', () => {
    const ctx: RequestContext = {
      requestId: 'req-1',
      orgId: 'org-1',
      userId: 'user-1',
      role: 'owner',
      clock,
      ids,
      logger,
    }

    expect(() => assertRole(ctx, ['owner', 'admin'])).not.toThrow()
  })

  it('assertRole throws forbidden for viewer when allowed is ["owner", "admin"]', () => {
    const ctx: RequestContext = {
      requestId: 'req-1',
      orgId: 'org-1',
      userId: 'user-1',
      role: 'viewer',
      clock,
      ids,
      logger,
    }

    try {
      assertRole(ctx, ['owner', 'admin'])
      expect.unreachable('Should have thrown AppError')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      if (err instanceof AppError) {
        expect(err.code).toBe(ERROR_CODES.FORBIDDEN)
        expect(err.httpStatus).toBe(403)
      }
    }
  })

  it('assertRole always allows system context', () => {
    const sysCtx: SystemContext = {
      requestId: 'req-1',
      orgId: 'org-1',
      userId: null,
      role: 'system',
      clock,
      ids,
      logger,
    }

    expect(() => assertRole(sysCtx, ['owner'])).not.toThrow()
    expect(() => assertRole(sysCtx, ['admin'])).not.toThrow()
  })
})

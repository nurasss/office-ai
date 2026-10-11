import { describe, expect, it } from 'vitest'
import {
  AppError,
  decodeCursor,
  encodeCursor,
  ERROR_CODES,
  paginationQuerySchema,
} from '../src/index.js'

describe('pagination', () => {
  it('encode -> decode round-trip preserves date milliseconds and uuid', () => {
    const exactIso = '2026-08-25T01:23:45.678Z'
    const row = {
      createdAt: new Date(exactIso),
      id: '01918361-b4f7-7890-8000-000000000001',
    }
    const cursor = encodeCursor(row)
    const decoded = decodeCursor(cursor)

    expect(decoded.id).toBe(row.id)
    expect(decoded.createdAt.getTime()).toBe(row.createdAt.getTime())
    expect(decoded.createdAt.toISOString()).toBe(exactIso)
  })

  it('garbage cursor throws AppError with VALIDATION_ERROR code', () => {
    const invalidCursors = ['not-base64-json', 'e30=', 'invalid-cursor-value']
    for (const cur of invalidCursors) {
      try {
        decodeCursor(cur)
        expect.unreachable('Should have thrown AppError')
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        if (err instanceof AppError) {
          expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR)
          expect(err.httpStatus).toBe(400)
        }
      }
    }
  })

  it('paginationQuerySchema handles defaults and limits', () => {
    const defaultParsed = paginationQuerySchema.parse({})
    expect(defaultParsed.limit).toBe(50)
    expect(defaultParsed.cursor).toBeUndefined()

    const customParsed = paginationQuerySchema.parse({ limit: '25', cursor: 'abc' })
    expect(customParsed.limit).toBe(25)
    expect(customParsed.cursor).toBe('abc')

    expect(() => paginationQuerySchema.parse({ limit: 0 })).toThrow()
    expect(() => paginationQuerySchema.parse({ limit: 201 })).toThrow()
  })
})

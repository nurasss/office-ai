import { z } from 'zod'
import { isAppError, validationError } from './errors.js'

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
})

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  const payload = JSON.stringify({
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  })
  return Buffer.from(payload, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const jsonStr = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(jsonStr)
    const result = cursorSchema.safeParse(parsed)
    if (!result.success) {
      throw validationError({ cursor: 'Invalid cursor structure' })
    }
    const createdAt = new Date(result.data.createdAt)
    if (isNaN(createdAt.getTime())) {
      throw validationError({ cursor: 'Invalid cursor timestamp' })
    }
    return {
      createdAt,
      id: result.data.id,
    }
  } catch (err) {
    if (isAppError(err)) {
      throw err
    }
    throw validationError({ cursor: 'Malformed cursor payload' })
  }
}

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

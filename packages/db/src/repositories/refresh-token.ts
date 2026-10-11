import { eq, and, isNull, lte } from 'drizzle-orm'
import type { Database, Tx } from '../client.js'
import { refreshTokens, type RefreshToken } from '../schema/auth.js'
import type { DbOrTx, RepoDeps } from './types.js'

export interface CreateRefreshTokenInput {
  id?: string
  userId: string
  tokenHash: string
  expiresAt: Date
  userAgent?: string | null
  ip?: string | null
}

export class RefreshTokenRepository {
  constructor(
    private readonly db: Database,
    private readonly deps: RepoDeps,
  ) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  async create(input: CreateRefreshTokenInput, tx?: Tx): Promise<RefreshToken> {
    const executor = this.getExecutor(tx)
    const now = this.deps.clock.now()
    const id = input.id ?? this.deps.ids.next()

    const [row] = await executor
      .insert(refreshTokens)
      .values({
        id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create refresh token')
    }

    return row
  }

  async findByHash(tokenHash: string, tx?: Tx): Promise<RefreshToken | null> {
    const executor = this.getExecutor(tx)
    const [row] = await executor
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)

    return row ?? null
  }

  async revoke(id: string, at?: Date, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    const revokedAt = at ?? this.deps.clock.now()
    await executor
      .update(refreshTokens)
      .set({
        revokedAt,
        updatedAt: this.deps.clock.now(),
      })
      .where(eq(refreshTokens.id, id))
  }

  async revokeAllForUser(userId: string, at?: Date, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    const revokedAt = at ?? this.deps.clock.now()
    await executor
      .update(refreshTokens)
      .set({
        revokedAt,
        updatedAt: this.deps.clock.now(),
      })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
  }

  async deleteExpired(before?: Date, tx?: Tx): Promise<number> {
    const executor = this.getExecutor(tx)
    const beforeDate = before ?? this.deps.clock.now()
    const result = await executor
      .delete(refreshTokens)
      .where(lte(refreshTokens.expiresAt, beforeDate))
      .returning({ id: refreshTokens.id })

    return result.length
  }
}

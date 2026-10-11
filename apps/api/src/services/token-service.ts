import crypto from 'node:crypto'
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import {
  env,
  AppError,
  ERROR_CODES,
  sha256Hex,
  parseDurationMs,
  parseDurationSeconds,
} from '@ai-company/shared'
import type { AppDeps } from '../deps.js'

export interface TokenMeta {
  userAgent?: string | null
  ip?: string | null
}

export class TokenService {
  private readonly jwtSecret: Uint8Array

  constructor(private readonly deps: AppDeps) {
    this.jwtSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET)
  }

  async issueAccessToken(userId: string): Promise<string> {
    const nowSec = Math.floor(this.deps.clock.now().getTime() / 1000)
    const ttlSec = parseDurationSeconds(env.JWT_ACCESS_TTL)
    const jti = this.deps.ids.next()

    return new SignJWT({ sub: userId, jti })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + ttlSec)
      .sign(this.jwtSecret)
  }

  async verifyAccessToken(token: string): Promise<{ sub: string; jti: string }> {
    try {
      const now = this.deps.clock.now()
      const { payload } = await jwtVerify(token, this.jwtSecret, {
        currentDate: now,
      })

      if (!payload.sub || typeof payload.sub !== 'string') {
        throw new AppError({
          code: ERROR_CODES.TOKEN_INVALID,
          httpStatus: 401,
          message: 'Access token payload missing sub claim',
        })
      }

      const jti = typeof payload.jti === 'string' ? payload.jti : ''

      return {
        sub: payload.sub,
        jti,
      }
    } catch (err) {
      if (err instanceof AppError) {
        throw err
      }
      if (err instanceof joseErrors.JWTExpired) {
        throw new AppError({
          code: ERROR_CODES.TOKEN_EXPIRED,
          httpStatus: 401,
          message: 'Access token has expired',
          cause: err,
        })
      }
      throw new AppError({
        code: ERROR_CODES.TOKEN_INVALID,
        httpStatus: 401,
        message: 'Invalid access token',
        cause: err,
      })
    }
  }

  async issueRefreshToken(
    userId: string,
    meta?: TokenMeta,
  ): Promise<{ token: string; expiresAt: Date }> {
    const rawToken = crypto.randomBytes(32).toString('base64url')
    const tokenHash = sha256Hex(rawToken)
    const ttlMs = parseDurationMs(env.JWT_REFRESH_TTL)
    const expiresAt = new Date(this.deps.clock.now().getTime() + ttlMs)

    await this.deps.repos.refreshTokens.create({
      userId,
      tokenHash,
      expiresAt,
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    })

    return {
      token: rawToken,
      expiresAt,
    }
  }

  async rotateRefreshToken(
    presentedToken: string,
    meta?: TokenMeta,
  ): Promise<{ access: string; refresh: string }> {
    const tokenHash = sha256Hex(presentedToken)
    const tokenRecord = await this.deps.repos.refreshTokens.findByHash(tokenHash)

    if (!tokenRecord) {
      throw new AppError({
        code: ERROR_CODES.TOKEN_INVALID,
        httpStatus: 401,
        message: 'Invalid refresh token',
      })
    }

    // Reuse detection: if token is already revoked, revoke all tokens for user
    if (tokenRecord.revokedAt !== null) {
      await this.deps.repos.refreshTokens.revokeAllForUser(
        tokenRecord.userId,
        this.deps.clock.now(),
      )

      // Record platform-level audit log entry
      try {
        await this.deps.repos.auditLogs.appendPlatform({
          clock: this.deps.clock,
          ids: this.deps.ids,
          actorType: 'system',
          actorId: tokenRecord.userId,
          action: 'auth.refresh_reuse_detected',
          resourceType: 'refresh_token',
          resourceId: tokenRecord.id,
          metadata: { ip: meta?.ip ?? null, userAgent: meta?.userAgent ?? null },
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        })
      } catch (err) {
        this.deps.logger.error({ msg: 'Failed to record audit log for refresh reuse', err })
      }

      throw new AppError({
        code: ERROR_CODES.TOKEN_INVALID,
        httpStatus: 401,
        message: 'Refresh token reuse detected. All sessions revoked.',
      })
    }

    // Check expiration
    if (tokenRecord.expiresAt.getTime() <= this.deps.clock.now().getTime()) {
      throw new AppError({
        code: ERROR_CODES.TOKEN_EXPIRED,
        httpStatus: 401,
        message: 'Refresh token has expired',
      })
    }

    // Mark current token as revoked
    await this.deps.repos.refreshTokens.revoke(tokenRecord.id, this.deps.clock.now())

    // Issue new pair
    const access = await this.issueAccessToken(tokenRecord.userId)
    const { token: refresh } = await this.issueRefreshToken(tokenRecord.userId, meta)

    return {
      access,
      refresh,
    }
  }

  async revokeRefreshToken(presentedToken: string): Promise<void> {
    const tokenHash = sha256Hex(presentedToken)
    const record = await this.deps.repos.refreshTokens.findByHash(tokenHash)
    if (record && record.revokedAt === null) {
      await this.deps.repos.refreshTokens.revoke(record.id, this.deps.clock.now())
      try {
        await this.deps.repos.auditLogs.appendPlatform({
          clock: this.deps.clock,
          ids: this.deps.ids,
          actorType: 'user',
          actorId: record.userId,
          action: 'auth.logout',
          resourceType: 'refresh_token',
          resourceId: record.id,
        })
      } catch (err) {
        this.deps.logger.error({ msg: 'Failed to record audit log for logout', err })
      }
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.deps.repos.refreshTokens.revokeAllForUser(userId, this.deps.clock.now())
    try {
      await this.deps.repos.auditLogs.appendPlatform({
        clock: this.deps.clock,
        ids: this.deps.ids,
        actorType: 'user',
        actorId: userId,
        action: 'auth.logout_all',
        resourceType: 'user',
        resourceId: userId,
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for logout_all', err })
    }
  }
}

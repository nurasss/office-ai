import {
  validationError,
  assertRole,
  type RequestContext,
} from '@ai-company/shared'
import type { SecretMetadata } from '@ai-company/db'
import type { AppDeps } from '../deps.js'

const KEY_REGEX = /^[A-Z][A-Z0-9_]{2,63}$/

export class SecretService {
  constructor(private readonly deps: AppDeps) {}

  async list(ctx: RequestContext, companyId?: string): Promise<SecretMetadata[]> {
    assertRole(ctx, ['owner', 'admin'])

    if (companyId) {
      await this.deps.repos.companies.findByIdOrThrow(ctx, companyId)
    }

    return this.deps.repos.secrets.list(ctx, companyId)
  }

  async set(
    ctx: RequestContext,
    key: string,
    value: string,
    companyId?: string,
  ): Promise<void> {
    assertRole(ctx, ['owner', 'admin'])

    if (!KEY_REGEX.test(key)) {
      throw validationError([
        {
          code: 'custom',
          path: ['key'],
          message: 'Invalid secret key. Key must match pattern ^[A-Z][A-Z0-9_]{2,63}$',
        },
      ])
    }

    if (value.length < 1 || value.length > 8192) {
      throw validationError([
        {
          code: 'custom',
          path: ['value'],
          message: 'Secret value length must be between 1 and 8192 characters',
        },
      ])
    }

    if (companyId) {
      await this.deps.repos.companies.findByIdOrThrow(ctx, companyId)
    }

    await this.deps.repos.secrets.set(ctx, key, value, companyId)

    try {
      // In audit log: ONLY key and companyId, NEVER value and NEVER length
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'secret.set',
        resourceType: 'secret',
        metadata: {
          key,
          companyId: companyId ?? null,
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for secret.set', err })
    }
  }

  async remove(ctx: RequestContext, key: string, companyId?: string): Promise<void> {
    assertRole(ctx, ['owner', 'admin'])

    if (companyId) {
      await this.deps.repos.companies.findByIdOrThrow(ctx, companyId)
    }

    await this.deps.repos.secrets.remove(ctx, key, companyId)

    try {
      // In audit log: ONLY key and companyId, NEVER value
      await this.deps.repos.auditLogs.append(ctx, {
        actorType: 'user',
        actorId: ctx.userId,
        action: 'secret.delete',
        resourceType: 'secret',
        metadata: {
          key,
          companyId: companyId ?? null,
        },
      })
    } catch (err) {
      this.deps.logger.error({ msg: 'Failed to record audit log for secret.delete', err })
    }
  }
}

import { eq, and, isNull } from 'drizzle-orm'
import { encryptSecret, decryptSecret } from '@ai-company/shared'
import type { Database, Tx } from '../client.js'
import { secrets } from '../schema/security.js'
import type { Ctx, DbOrTx } from './types.js'

export interface SecretMetadata {
  key: string
  isSet: true
  updatedAt: Date
}

export class SecretRepository {
  constructor(private readonly db: Database) {}

  private getExecutor(tx?: Tx): DbOrTx {
    return tx ?? this.db
  }

  /**
   * Lists secrets for an organization or specific company.
   * NEVER returns decrypted or encrypted values to prevent leaking credentials in responses.
   */
  async list(ctx: Ctx, companyId?: string, tx?: Tx): Promise<SecretMetadata[]> {
    const executor = this.getExecutor(tx)
    const conditions = [eq(secrets.orgId, ctx.orgId)]

    if (companyId) {
      conditions.push(eq(secrets.companyId, companyId))
    } else {
      conditions.push(isNull(secrets.companyId))
    }

    const rows = await executor
      .select({
        key: secrets.key,
        updatedAt: secrets.updatedAt,
      })
      .from(secrets)
      .where(and(...conditions))

    return rows.map((r) => ({
      key: r.key,
      isSet: true as const,
      updatedAt: r.updatedAt,
    }))
  }

  /**
   * Scope resolution rule:
   * 1. If `companyId` is provided, first search for a company-scoped secret.
   * 2. If a company secret is found, decrypt and return it (company overrides org-level).
   * 3. If no company secret exists (or no `companyId` was specified), fallback to org-level secret (`company_id IS NULL`).
   * 4. If neither exists, return `null`.
   */
  async get(ctx: Ctx, key: string, companyId?: string, tx?: Tx): Promise<string | null> {
    const executor = this.getExecutor(tx)

    if (companyId) {
      const [companySecret] = await executor
        .select()
        .from(secrets)
        .where(
          and(
            eq(secrets.orgId, ctx.orgId),
            eq(secrets.companyId, companyId),
            eq(secrets.key, key),
          ),
        )
        .limit(1)

      if (companySecret) {
        return decryptSecret(companySecret.valueEncrypted)
      }
    }

    const [orgSecret] = await executor
      .select()
      .from(secrets)
      .where(
        and(
          eq(secrets.orgId, ctx.orgId),
          isNull(secrets.companyId),
          eq(secrets.key, key),
        ),
      )
      .limit(1)

    if (orgSecret) {
      return decryptSecret(orgSecret.valueEncrypted)
    }

    return null
  }

  async set(
    ctx: Ctx,
    key: string,
    plainValue: string,
    companyId?: string,
    tx?: Tx,
  ): Promise<void> {
    const executor = this.getExecutor(tx)
    const encrypted = encryptSecret(plainValue)
    const now = ctx.clock.now()
    const createdBy = 'userId' in ctx ? ctx.userId : null

    const condition = companyId
      ? and(
          eq(secrets.orgId, ctx.orgId),
          eq(secrets.companyId, companyId),
          eq(secrets.key, key),
        )
      : and(
          eq(secrets.orgId, ctx.orgId),
          isNull(secrets.companyId),
          eq(secrets.key, key),
        )

    const [existing] = await executor
      .select({ id: secrets.id })
      .from(secrets)
      .where(condition)
      .limit(1)

    if (existing) {
      await executor
        .update(secrets)
        .set({
          valueEncrypted: encrypted,
          updatedAt: now,
        })
        .where(eq(secrets.id, existing.id))
    } else {
      const id = ctx.ids.next()
      await executor.insert(secrets).values({
        id,
        orgId: ctx.orgId,
        companyId: companyId ?? null,
        key,
        valueEncrypted: encrypted,
        createdBy,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  async remove(ctx: Ctx, key: string, companyId?: string, tx?: Tx): Promise<void> {
    const executor = this.getExecutor(tx)
    const condition = companyId
      ? and(
          eq(secrets.orgId, ctx.orgId),
          eq(secrets.companyId, companyId),
          eq(secrets.key, key),
        )
      : and(
          eq(secrets.orgId, ctx.orgId),
          isNull(secrets.companyId),
          eq(secrets.key, key),
        )

    await executor.delete(secrets).where(condition)
  }
}

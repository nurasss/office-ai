import { pgTable, text, timestamp, uniqueIndex, uuid, index, inet } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    lastLoginAt: timestamp('last_login_at', { precision: 3, withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_uniq').on(sql`lower(${table.email})`)],
)

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', {
      precision: 3,
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    revokedAt: timestamp('revoked_at', { precision: 3, withTimezone: true, mode: 'date' }),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('refresh_tokens_user_id_expires_at_idx').on(table.userId, table.expiresAt)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type RefreshToken = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert

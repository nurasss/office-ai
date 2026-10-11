import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
  jsonb,
  inet,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './org.js'
import { companies } from './company.js'
import { users } from './auth.js'

export const secrets = pgTable(
  'secrets',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('secrets_org_key_uniq')
      .on(table.orgId, table.key)
      .where(sql`company_id IS NULL`),
    uniqueIndex('secrets_org_company_key_uniq')
      .on(table.orgId, table.companyId, table.key)
      .where(sql`company_id IS NOT NULL`),
  ],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id'),
    actorType: text('actor_type', { enum: ['user', 'agent', 'system'] }).notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_logs_org_id_created_at_idx').on(table.orgId, table.createdAt.desc()),
    index('audit_logs_org_id_resource_type_resource_id_idx').on(
      table.orgId,
      table.resourceType,
      table.resourceId,
    ),
  ],
)

export type Secret = typeof secrets.$inferSelect
export type NewSecret = typeof secrets.$inferInsert
export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert

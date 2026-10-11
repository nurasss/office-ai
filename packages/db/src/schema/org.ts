import { pgTable, text, timestamp, uniqueIndex, uuid, index, numeric } from 'drizzle-orm/pg-core'
import { users } from './auth.js'

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan', { enum: ['free', 'pro', 'enterprise'] })
    .notNull()
    .default('free'),
  monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 14, scale: 6 })
    .notNull()
    .default('100.000000'),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('organization_members_org_id_user_id_uniq').on(table.orgId, table.userId),
    index('organization_members_user_id_idx').on(table.userId),
  ],
)

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrganizationMember = typeof organizationMembers.$inferSelect
export type NewOrganizationMember = typeof organizationMembers.$inferInsert

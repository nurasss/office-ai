import {
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
  numeric,
  jsonb,
  smallint,
  integer,
} from 'drizzle-orm/pg-core'
import { organizations } from './org.js'

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    mission: text('mission'),
    mode: text('mode', { enum: ['assistant', 'copilot', 'autonomous'] })
      .notNull()
      .default('copilot'),
    status: text('status', { enum: ['active', 'paused', 'archived'] })
      .notNull()
      .default('active'),
    monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 14, scale: 6 })
      .notNull()
      .default('50.000000'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('companies_org_id_slug_uniq').on(table.orgId, table.slug),
    index('companies_org_id_created_at_id_idx').on(
      table.orgId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
)

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    parentDepartmentId: uuid('parent_department_id').references((): AnyPgColumn => departments.id, {
      onDelete: 'set null',
    }),
    monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 14, scale: 6 }),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('departments_company_id_code_uniq').on(table.companyId, table.code),
    index('departments_org_id_company_id_idx').on(table.orgId, table.companyId),
  ],
)

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    managerAgentId: uuid('manager_agent_id').references((): AnyPgColumn => agents.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    role: text('role').notNull(),
    title: text('title').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    systemPromptVersion: integer('system_prompt_version').notNull().default(1),
    maxAutonomyLevel: smallint('max_autonomy_level').notNull().default(1),
    monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 14, scale: 6 })
      .notNull()
      .default('10.000000'),
    status: text('status', { enum: ['draft', 'active', 'paused', 'retired'] })
      .notNull()
      .default('active'),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agents_company_id_name_uniq').on(table.companyId, table.name),
    index('agents_org_id_company_id_created_at_id_idx').on(
      table.orgId,
      table.companyId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('agents_org_id_department_id_idx').on(table.orgId, table.departmentId),
  ],
)

export type Company = typeof companies.$inferSelect
export type NewCompany = typeof companies.$inferInsert
export type Department = typeof departments.$inferSelect
export type NewDepartment = typeof departments.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert

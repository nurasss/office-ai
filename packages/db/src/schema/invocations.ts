import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { organizations } from './org.js'
import { companies, agents } from './company.js'
import { models } from './catalog.js'

export const modelInvocations = pgTable(
  'model_invocations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    modelKey: text('model_key').notNull(),
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull(),
    attempt: smallint('attempt').notNull().default(1),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 14, scale: 6 }).notNull().default('0.000000'),
    latencyMs: integer('latency_ms').notNull().default(0),
    status: text('status', { enum: ['success', 'error'] }).notNull(),
    stopReason: text('stop_reason'),
    errorKind: text('error_kind'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('model_invocations_org_created_idx').on(table.orgId, table.createdAt.desc()),
    index('model_invocations_org_agent_created_idx').on(
      table.orgId,
      table.agentId,
      table.createdAt.desc(),
    ),
    index('model_invocations_org_model_key_idx').on(table.orgId, table.modelKey),
  ],
)

export type ModelInvocation = typeof modelInvocations.$inferSelect
export type NewModelInvocation = typeof modelInvocations.$inferInsert

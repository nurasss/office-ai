import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  numeric,
  integer,
  smallint,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core'

export const models = pgTable(
  'models',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider', { enum: ['openai', 'anthropic', 'google'] }).notNull(),
    modelKey: text('model_key').notNull(),
    displayName: text('display_name').notNull(),
    tier: text('tier', { enum: ['frontier', 'balanced', 'cheap'] }).notNull(),
    contextWindow: integer('context_window').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    inputPricePerMillion: numeric('input_price_per_million', { precision: 14, scale: 6 }).notNull(),
    outputPricePerMillion: numeric('output_price_per_million', { precision: 14, scale: 6 }).notNull(),
    cachedInputPricePerMillion: numeric('cached_input_price_per_million', { precision: 14, scale: 6 }),
    supportsTools: boolean('supports_tools').notNull().default(true),
    supportsStructuredOutput: boolean('supports_structured_output').notNull().default(true),
    supportsStreaming: boolean('supports_streaming').notNull().default(true),
    supportsVision: boolean('supports_vision').notNull().default(false),
    qualityScore: smallint('quality_score').notNull().default(50),
    avgLatencyMs: integer('avg_latency_ms'),
    status: text('status', { enum: ['active', 'deprecated'] })
      .notNull()
      .default('active'),
    pricingVerified: boolean('pricing_verified').notNull().default(false),
    pricingVerifiedAt: timestamp('pricing_verified_at', { precision: 3, withTimezone: true, mode: 'date' }),
    pricingSourceUrl: text('pricing_source_url'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('models_provider_model_key_uniq').on(table.provider, table.modelKey)],
)

export const tools = pgTable('tools', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category', {
    enum: ['research', 'development', 'communication', 'data', 'finance', 'system'],
  }).notNull(),
  autonomyLevel: smallint('autonomy_level').notNull(),
  inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull(),
  outputSchema: jsonb('output_schema').$type<Record<string, unknown>>(),
  requiredSecretKey: text('required_secret_key'),
  isReadOnly: boolean('is_read_only').notNull().default(false),
  status: text('status', { enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category', {
    enum: ['engineering', 'marketing', 'finance', 'research', 'operations', 'legal'],
  }).notNull(),
  status: text('status', { enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

export type Model = typeof models.$inferSelect
export type NewModel = typeof models.$inferInsert
export type Tool = typeof tools.$inferSelect
export type NewTool = typeof tools.$inferInsert
export type Skill = typeof skills.$inferSelect
export type NewSkill = typeof skills.$inferInsert

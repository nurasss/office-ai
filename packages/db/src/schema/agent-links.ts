import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
  numeric,
  integer,
  smallint,
  boolean,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { agents } from './company.js'
import { models, tools, skills } from './catalog.js'

export const agentModels = pgTable(
  'agent_models',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'restrict' }),
    role: text('role', { enum: ['preferred', 'fallback'] }).notNull(),
    priority: smallint('priority').notNull().default(0),
    temperature: numeric('temperature', { precision: 3, scale: 2 }),
    maxOutputTokens: integer('max_output_tokens'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_models_agent_id_model_id_uniq').on(table.agentId, table.modelId),
    uniqueIndex('agent_models_one_preferred')
      .on(table.agentId)
      .where(sql`role = 'preferred'`),
  ],
)

export const agentTools = pgTable(
  'agent_tools',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'restrict' }),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_tools_agent_id_tool_id_uniq').on(table.agentId, table.toolId),
    index('agent_tools_org_id_agent_id_idx').on(table.orgId, table.agentId),
  ],
)

export const agentSkills = pgTable(
  'agent_skills',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    level: text('level', { enum: ['basic', 'proficient', 'expert'] })
      .notNull()
      .default('proficient'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('agent_skills_agent_id_skill_id_uniq').on(table.agentId, table.skillId)],
)

export type AgentModel = typeof agentModels.$inferSelect
export type NewAgentModel = typeof agentModels.$inferInsert
export type AgentTool = typeof agentTools.$inferSelect
export type NewAgentTool = typeof agentTools.$inferInsert
export type AgentSkill = typeof agentSkills.$inferSelect
export type NewAgentSkill = typeof agentSkills.$inferInsert

import type { Database } from '../client.js'
import { CompanyRepository } from './company.js'
import { DepartmentRepository } from './department.js'
import { AgentRepository } from './agent.js'
import { AgentModelRepository } from './agent-model.js'
import { AgentToolRepository } from './agent-tool.js'
import { AgentSkillRepository } from './agent-skill.js'
import { SecretRepository } from './secret.js'
import { AuthRepository } from './auth.js'
import { RefreshTokenRepository } from './refresh-token.js'
import { AuditLogRepository } from './audit-log.js'
import { CatalogRepository } from './catalog.js'
import { ModelInvocationRepository } from './model-invocation.js'
import type { RepoDeps } from './types.js'

export * from './types.js'
export * from './company.js'
export * from './department.js'
export * from './agent.js'
export * from './agent-model.js'
export * from './agent-tool.js'
export * from './agent-skill.js'
export * from './secret.js'
export * from './auth.js'
export * from './refresh-token.js'
export * from './audit-log.js'
export * from './catalog.js'
export * from './model-invocation.js'

export interface Repositories {
  companies: CompanyRepository
  departments: DepartmentRepository
  agents: AgentRepository
  agentModels: AgentModelRepository
  agentTools: AgentToolRepository
  agentSkills: AgentSkillRepository
  secrets: SecretRepository
  auth: AuthRepository
  refreshTokens: RefreshTokenRepository
  auditLogs: AuditLogRepository
  catalog: CatalogRepository
  modelInvocations: ModelInvocationRepository
}

export function createRepositories(db: Database, deps: RepoDeps): Repositories {
  return {
    companies: new CompanyRepository(db),
    departments: new DepartmentRepository(db),
    agents: new AgentRepository(db),
    agentModels: new AgentModelRepository(db),
    agentTools: new AgentToolRepository(db),
    agentSkills: new AgentSkillRepository(db),
    secrets: new SecretRepository(db),
    auth: new AuthRepository(db, deps),
    refreshTokens: new RefreshTokenRepository(db, deps),
    auditLogs: new AuditLogRepository(db),
    catalog: new CatalogRepository(db),
    modelInvocations: new ModelInvocationRepository(db),
  }
}

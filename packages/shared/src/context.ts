import type { Clock } from './clock.js'
import type { IdGenerator } from './id.js'
import type { Logger } from './logger.js'
import { forbidden } from './errors.js'

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface RequestContext {
  requestId: string
  orgId: string
  userId: string
  role: OrgRole
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export interface SystemContext {
  requestId: string
  orgId: string
  userId: null
  role: 'system'
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type AnyContext = RequestContext | SystemContext

export function assertRole(ctx: AnyContext, allowed: OrgRole[]): void {
  if (ctx.role === 'system') {
    return
  }
  if (!allowed.includes(ctx.role)) {
    throw forbidden(`Role '${ctx.role}' is not authorized. Allowed roles: ${allowed.join(', ')}`)
  }
}

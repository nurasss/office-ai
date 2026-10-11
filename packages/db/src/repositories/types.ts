import type { RequestContext, SystemContext, PaginationQuery, Clock, IdGenerator } from '@ai-company/shared'
import type { Database, Tx } from '../client.js'

export type Ctx = RequestContext | SystemContext
export type DbOrTx = Database | Tx

export type ListOptions = PaginationQuery

export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
}

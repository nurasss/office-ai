import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { type ExtractTablesWithRelations, sql } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import { env } from '@ai-company/shared'
import * as schema from './schema/index.js'

export { sql }

// Ensure Postgres numeric (OID 1700) is parsed as string to prevent precision loss
pg.types.setTypeParser(1700, (val: string) => val)

export type Database = NodePgDatabase<typeof schema>
export type Tx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

let globalPool: pg.Pool | null = null
let globalDb: Database | null = null

export function getPool(connectionString?: string): pg.Pool {
  if (!globalPool) {
    globalPool = new pg.Pool({
      connectionString: connectionString ?? env.DATABASE_URL,
      max: 10,
      application_name: 'ai-company-api',
    })
  }
  return globalPool
}

export function createDatabase(connectionString?: string): Database {
  if (!globalDb) {
    const pool = getPool(connectionString)
    globalDb = drizzle(pool, { schema })
  }
  return globalDb
}

export async function closeDatabase(): Promise<void> {
  if (globalPool) {
    await globalPool.end()
    globalPool = null
    globalDb = null
  }
}

export async function isDatabaseReachable(connectionString?: string): Promise<boolean> {
  const pool = new pg.Pool({
    connectionString: connectionString ?? env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    max: 1,
  })

  try {
    const client = await pool.connect()
    client.release()
    await pool.end()
    return true
  } catch {
    await pool.end().catch(() => {})
    if (env.REQUIRE_DB) {
      throw new Error(
        `Database is required (REQUIRE_DB=true), but connection failed for: ${connectionString ?? env.DATABASE_URL}`,
      )
    }
    return false
  }
}

export async function withTransaction<T>(
  db: Database,
  fn: (tx: Tx) => Promise<T>,
  existingTx?: Tx,
): Promise<T> {
  if (existingTx) {
    return fn(existingTx)
  }
  return db.transaction((tx) => fn(tx as Tx))
}


import pg from 'pg'
import { sql } from 'drizzle-orm'
import { env } from '@ai-company/shared'
import type { Database } from '../../src/client.js'
import { runMigrations } from '../../src/scripts/migrate.js'

export function extractDatabaseName(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    return url.pathname.replace(/^\//, '').split('?')[0] ?? ''
  } catch {
    const match = connectionString.match(/\/([^/?]+)(\?|$)/)
    return match?.[1] ?? ''
  }
}

export function assertTestDatabase(dbName: string): void {
  if (!dbName || !dbName.includes('_test')) {
    throw new Error(`Refusing to operate on non-test database "${dbName}"`)
  }
}

export async function ensureDatabaseExists(
  connectionString: string = env.DATABASE_URL,
): Promise<void> {
  const dbName = extractDatabaseName(connectionString)
  assertTestDatabase(dbName)

  const url = new URL(connectionString)
  url.pathname = '/postgres'
  const adminUrl = url.toString()

  const pool = new pg.Pool({
    connectionString: adminUrl,
    connectionTimeoutMillis: 2000,
    max: 1,
  })

  try {
    const client = await pool.connect()
    try {
      const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1;', [dbName])
      if (res.rowCount === 0) {
        await client.query(`CREATE DATABASE "${dbName}";`)
      }
    } finally {
      client.release()
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

export async function isDatabaseReachable(
  connectionString: string = env.DATABASE_URL,
): Promise<boolean> {
  const url = new URL(connectionString)
  url.pathname = '/postgres'
  const adminUrl = url.toString()

  const pool = new pg.Pool({
    connectionString: adminUrl,
    connectionTimeoutMillis: 2000,
    max: 1,
  })

  try {
    const client = await pool.connect()
    client.release()
    await pool.end()
    await ensureDatabaseExists(connectionString)
    await runMigrations(connectionString)
    return true
  } catch {
    await pool.end().catch(() => {})
    if (env.REQUIRE_DB) {
      throw new Error(
        `Database is required (REQUIRE_DB=true), but connection failed for: ${connectionString}`,
      )
    }
    return false
  }
}

export async function setupTestDatabase(
  connectionString: string = env.DATABASE_URL,
): Promise<void> {
  const dbName = extractDatabaseName(connectionString)
  assertTestDatabase(dbName)
  await ensureDatabaseExists(connectionString)
  await runMigrations(connectionString)
}

export async function truncateAll(db: Database): Promise<void> {
  // Safety guard: query PostgreSQL for the connected database name
  const currentDbResult = await db.execute<{ current_database: string }>(
    sql`SELECT current_database();`,
  )
  const currentDbName = currentDbResult.rows[0]?.current_database ?? ''
  assertTestDatabase(currentDbName)

  // Dynamically query all public user tables excluding schema_migrations
  const tablesResult = await db.execute<{ table_name: string }>(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE' 
      AND table_name != 'schema_migrations';
  `)

  const tableNames = tablesResult.rows.map((row) => `"${row.table_name}"`)

  if (tableNames.length > 0) {
    const query = `TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE;`
    await db.execute(sql.raw(query))
  }
}

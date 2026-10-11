import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { env, rootLogger } from '@ai-company/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const downMigrationsDir = path.resolve(__dirname, '../../migrations/down')

export async function rollbackLastMigration(
  connectionString: string = env.DATABASE_URL,
): Promise<string | null> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  const client = await pool.connect()

  try {
    const { rows: tableCheck } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'
      );
    `)

    if (!tableCheck[0]?.exists) {
      rootLogger.info('schema_migrations table does not exist. Nothing to rollback.')
      return null
    }

    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
    )

    if (rows.length === 0 || !rows[0]) {
      rootLogger.info('No migrations recorded in schema_migrations. Nothing to rollback.')
      return null
    }

    const lastMigrationName = rows[0].name
    const baseName = lastMigrationName.replace(/\.sql$/, '')
    const downFileName = `${baseName}.down.sql`
    const downFilePath = path.join(downMigrationsDir, downFileName)

    if (!fs.existsSync(downFilePath)) {
      throw new Error(`Down migration file not found: ${downFilePath}`)
    }

    const downSql = fs.readFileSync(downFilePath, 'utf8')

    rootLogger.info(
      { migration: lastMigrationName },
      `Rolling back migration: ${lastMigrationName}`,
    )

    await client.query('BEGIN')
    try {
      await client.query(downSql)
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [lastMigrationName])
      await client.query('COMMIT')
      rootLogger.info(
        { migration: lastMigrationName },
        `Successfully rolled back migration: ${lastMigrationName}`,
      )
      return lastMigrationName
    } catch (err) {
      await client.query('ROLLBACK')
      rootLogger.error(
        { migration: lastMigrationName, err },
        `Failed to rollback migration: ${lastMigrationName}`,
      )
      throw err
    }
  } finally {
    client.release()
    await pool.end()
  }
}

// Execute directly if run via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rollbackLastMigration()
    .then((rolledBack) => {
      if (rolledBack) {
        console.log(`✅ Rollback complete. Rolled back: ${rolledBack}`)
      } else {
        console.log('ℹ️ No migrations were rolled back.')
      }
      process.exit(0)
    })
    .catch((err) => {
      console.error('❌ Rollback failed:', err)
      process.exit(1)
    })
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { env, rootLogger } from '@ai-company/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const migrationsDir = path.resolve(__dirname, '../../migrations')

export async function runMigrations(
  connectionString: string = env.DATABASE_URL,
): Promise<string[]> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  const client = await pool.connect()

  const appliedMigrations: string[] = []

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz(3) NOT NULL DEFAULT now()
      );
    `)

    const { rows: existingRows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name ASC',
    )
    const appliedSet = new Set(existingRows.map((r) => r.name))

    const files = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name)
      .sort()

    const pending = files.filter((f) => !appliedSet.has(f))

    if (pending.length === 0) {
      rootLogger.info('No pending migrations to apply. Database schema is up to date.')
      return []
    }

    for (const file of pending) {
      const filePath = path.join(migrationsDir, file)
      const sql = fs.readFileSync(filePath, 'utf8')

      rootLogger.info({ migration: file }, `Applying migration: ${file}`)

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, now())', [
          file,
        ])
        await client.query('COMMIT')
        appliedMigrations.push(file)
        rootLogger.info({ migration: file }, `Successfully applied migration: ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        rootLogger.error({ migration: file, err }, `Failed to apply migration: ${file}`)
        throw err
      }
    }

    return appliedMigrations
  } finally {
    client.release()
    await pool.end()
  }
}

// Execute directly if run via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((applied) => {
      console.log(`✅ Migration run complete. Applied: ${applied.length} migration(s).`)
      process.exit(0)
    })
    .catch((err) => {
      console.error('❌ Migration failed:', err)
      process.exit(1)
    })
}

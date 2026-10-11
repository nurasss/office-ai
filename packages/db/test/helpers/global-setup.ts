import { env } from '@ai-company/shared'
import { setupTestDatabase, isDatabaseReachable } from './db.js'

export default async function setup() {
  const reachable = await isDatabaseReachable(env.DATABASE_URL)
  if (reachable) {
    await setupTestDatabase(env.DATABASE_URL)
  }
}

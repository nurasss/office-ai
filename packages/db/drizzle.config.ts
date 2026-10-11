import { defineConfig } from 'drizzle-kit'
import { env } from '@ai-company/shared'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})

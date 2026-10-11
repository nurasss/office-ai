import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  CORS_ORIGINS: z.string().min(1).default('*'),
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().default('postgres://ai:ai@localhost:5432/ai_company_test'),
  REQUIRE_DB: z
    .preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean())
    .default(false),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  JWT_REFRESH_TTL: z.string().min(1).default('30d'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be exactly 64 hex characters'),
  ALLOW_UNVERIFIED_MODEL_PRICING: z
    .preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean())
    .default(false),
  TEST_DB_SUFFIX: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  RUN_LIVE_MODEL_TESTS: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function loadDotEnvHierarchy(): void {
  let curr = process.cwd()
  while (true) {
    const candidate = path.join(curr, '.env')
    if (fs.existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate)
      } catch {
        // Ignore load error
      }
      return
    }
    const parent = path.dirname(curr)
    if (parent === curr) break
    curr = parent
  }
}

export function parseEnv(): Env {
  loadDotEnvHierarchy()

  const isTest = process.env['NODE_ENV'] === 'test'
  const testDbSuffix = process.env['TEST_DB_SUFFIX']
  const baseTestDbUrl =
    process.env['TEST_DATABASE_URL'] ?? 'postgres://ai:ai@localhost:5432/ai_company_test'

  let testDbUrl = baseTestDbUrl
  if (isTest && testDbSuffix) {
    try {
      const url = new URL(baseTestDbUrl)
      let dbName = url.pathname.replace(/^\//, '')
      if (!dbName.includes('_test')) {
        dbName = `${dbName}_test`
      }
      dbName = `${dbName}_${testDbSuffix}`
      url.pathname = `/${dbName}`
      testDbUrl = url.toString()
    } catch {
      // Ignore URL parsing error
    }
  }

  const rawEnv: Record<string, unknown> = {
    ...process.env,
    TEST_DATABASE_URL: testDbUrl,
    ...(isTest
      ? {
          DATABASE_URL: testDbUrl,
          TEST_DB_SUFFIX: testDbSuffix,
          REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
          S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
          S3_BUCKET: process.env['S3_BUCKET'] ?? 'ai-company-test',
          S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? 'test-minio-key',
          S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? 'test-minio-secret',
          JWT_ACCESS_SECRET:
            process.env['JWT_ACCESS_SECRET'] ?? 'test-jwt-access-secret-min-32-characters-long!',
          JWT_REFRESH_SECRET:
            process.env['JWT_REFRESH_SECRET'] ?? 'test-jwt-refresh-secret-min-32-characters-long!',
          ENCRYPTION_KEY:
            process.env['ENCRYPTION_KEY'] ??
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        }
      : {}),
  }

  const result = envSchema.safeParse(rawEnv)

  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    console.error(`❌ Invalid environment variables:\n${formattedErrors}`)
    process.exit(1)
  }

  return result.data
}

export const env: Env = parseEnv()

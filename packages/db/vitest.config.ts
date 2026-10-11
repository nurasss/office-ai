import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/helpers/global-setup.ts'],
    fileParallelism: false,
    env: {
      TEST_DB_SUFFIX: 'db',
    },
    coverage: {
      provider: 'v8',
    },
  },
})

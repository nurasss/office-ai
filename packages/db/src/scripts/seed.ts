import { fileURLToPath } from 'node:url'
import { createDatabase, closeDatabase } from '../client.js'
import { seedModelCatalog } from '../seed/model-catalog.js'
import { seedToolCatalog } from '../seed/tool-catalog.js'
import { seedSkillCatalog } from '../seed/skill-catalog.js'
import { seedDemoCompany } from '../seed/demo-company.js'
import { rootLogger } from '@ai-company/shared'

export async function runSeed(connectionString?: string): Promise<void> {
  const db = createDatabase(connectionString)

  rootLogger.info('Starting seed: models, tools, skills, demo company...')

  await seedModelCatalog(db)
  rootLogger.info('✅ Seeded model catalog')

  await seedToolCatalog(db)
  rootLogger.info('✅ Seeded tool catalog')

  await seedSkillCatalog(db)
  rootLogger.info('✅ Seeded skill catalog')

  await seedDemoCompany(db)
  rootLogger.info('✅ Seeded demo company with agents, models, tools, and skills')

  rootLogger.info('Seed completed successfully.')
}

// Execute directly if run via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed()
    .then(async () => {
      console.log('✅ Database seed completed successfully.')
      await closeDatabase()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('❌ Database seed failed:', err)
      await closeDatabase()
      process.exit(1)
    })
}

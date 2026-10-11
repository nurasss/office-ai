import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Architecture Rules (@ai-company/db)', () => {
  const srcDir = path.resolve(__dirname, '../src')
  const reposDir = path.resolve(srcDir, 'repositories')
  const scriptsDir = path.resolve(srcDir, 'scripts')
  const seedDir = path.resolve(srcDir, 'seed')

  function getAllTsFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...getAllTsFiles(fullPath))
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath)
      }
    }
    return files
  }

  it('1. No direct db query operations (db.select/insert/update/delete) outside repositories, scripts, and seed', () => {
    const allSrcFiles = getAllTsFiles(srcDir)
    const allowedDirs = [reposDir, scriptsDir, seedDir]

    const violations: string[] = []

    for (const file of allSrcFiles) {
      const inAllowedDir = allowedDirs.some((allowed) => file.startsWith(allowed))
      if (inAllowedDir) continue

      const content = fs.readFileSync(file, 'utf8')
      const forbiddenPatterns = [
        'db.select(',
        'db.insert(',
        'db.update(',
        'db.delete(',
      ]

      for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
          violations.push(`${file} contains forbidden direct query: "${pattern}"`)
        }
      }
    }

    expect(
      violations,
      `Direct DB queries found outside repositories/scripts/seed:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('2. Every org-scoped repository file contains ctx.orgId filter', () => {
    const repoFiles = fs
      .readdirSync(reposDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(reposDir, f))

    const exemptFiles = new Set([
      'types.ts',
      'index.ts',
      'catalog.ts',
      'auth.ts',
      'refresh-token.ts',
    ])

    const missingOrgId: string[] = []

    for (const file of repoFiles) {
      const baseName = path.basename(file)
      if (exemptFiles.has(baseName)) continue

      const content = fs.readFileSync(file, 'utf8')
      if (!content.includes('ctx.orgId')) {
        missingOrgId.push(baseName)
      }
    }

    expect(
      missingOrgId,
      `Org-scoped repositories missing mandatory "ctx.orgId" filter:\n${missingOrgId.join('\n')}`,
    ).toEqual([])
  })

  it('3. Repository files do NOT contain systemClock or realIdGenerator', () => {
    const repoFiles = fs
      .readdirSync(reposDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(reposDir, f))

    const violations: string[] = []

    for (const file of repoFiles) {
      const content = fs.readFileSync(file, 'utf8')
      const baseName = path.basename(file)
      if (content.includes('systemClock')) {
        violations.push(`${baseName} contains systemClock`)
      }
      if (content.includes('realIdGenerator')) {
        violations.push(`${baseName} contains realIdGenerator`)
      }
    }

    expect(
      violations,
      `Direct clock/id generators found in repositories:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('4. packages/db/src does NOT contain prototype.query', () => {
    const allSrcFiles = getAllTsFiles(srcDir)
    const violations: string[] = []

    for (const file of allSrcFiles) {
      const content = fs.readFileSync(file, 'utf8')
      if (content.includes('prototype.query')) {
        violations.push(`${path.relative(srcDir, file)} contains prototype.query`)
      }
    }

    expect(
      violations,
      `Forbidden prototype.query found in packages/db/src:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})


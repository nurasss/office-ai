import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Architecture Rules (@ai-company/api)', () => {
  const srcDir = path.resolve(__dirname, '../src')
  const servicesDir = path.resolve(srcDir, 'services')

  function getAllTsFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
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

  it('1. Services do NOT import Fastify or its types', () => {
    const serviceFiles = getAllTsFiles(servicesDir)
    const violations: string[] = []

    for (const file of serviceFiles) {
      const content = fs.readFileSync(file, 'utf8')
      const baseName = path.basename(file)
      if (content.includes('fastify') || content.includes('FastifyRequest') || content.includes('FastifyReply')) {
        violations.push(`${baseName} imports Fastify`)
      }
    }

    expect(
      violations,
      `Service layer must NOT depend on Fastify:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('2. Direct process.env access is forbidden across apps/api', () => {
    const allFiles = getAllTsFiles(srcDir)
    const violations: string[] = []

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8')
      const baseName = path.basename(file)
      if (content.includes('process.env')) {
        violations.push(`${baseName} accesses process.env directly`)
      }
    }

    expect(
      violations,
      `Direct process.env access is forbidden:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

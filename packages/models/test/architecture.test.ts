import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Architecture Rules (@ai-company/models)', () => {
  const modelsRoot = path.resolve(__dirname, '..')
  const srcDir = path.resolve(modelsRoot, 'src')
  const packageJsonPath = path.resolve(modelsRoot, 'package.json')

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

  it('1. packages/models/package.json only has permitted provider SDKs (Anthropic in Step 8; OpenAI/Google forbidden until Step 9)', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    }

    const forbiddenSDKs = [
      'openai',
      '@google/genai',
      '@google/generative-ai',
      'langchain',
    ]

    for (const sdk of forbiddenSDKs) {
      expect(allDeps[sdk], `Found forbidden SDK dependency "${sdk}" in packages/models/package.json`).toBeUndefined()
    }
  })

  it('2. Core files in packages/models/src/ do NOT import any provider SDKs', () => {
    const allSrcFiles = getAllTsFiles(srcDir)
    const forbiddenImportsEverywhere = [
      'openai',
      '@google/genai',
      '@google/generative-ai',
      'langchain',
    ]

    const violations: string[] = []

    for (const file of allSrcFiles) {
      const relPath = path.relative(srcDir, file)
      const content = fs.readFileSync(file, 'utf8')

      // Check globally forbidden SDKs
      for (const forbidden of forbiddenImportsEverywhere) {
        const importRegex = new RegExp(`from\\s+['"]${forbidden}['"]|import\\s+['"]${forbidden}['"]`)
        if (importRegex.test(content)) {
          violations.push(`${relPath} imports forbidden SDK "${forbidden}"`)
        }
      }

      // Check that core files outside providers/anthropic do NOT import @anthropic-ai/sdk
      if (!relPath.startsWith('providers/anthropic')) {
        const anthropicRegex = /from\s+['"]@anthropic-ai\/sdk['"]|import\s+['"]@anthropic-ai\/sdk['"]/
        if (anthropicRegex.test(content)) {
          violations.push(`${relPath} (core file) must not import "@anthropic-ai/sdk"`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('3. packages/models/src contains ZERO explicit "any"', () => {
    const allSrcFiles = getAllTsFiles(srcDir)
    const violations: string[] = []

    // Check for : any, as any, <any>, any[]
    const anyRegex = /:\s*any\b|as\s+any\b|<any>|any\[\]/

    for (const file of allSrcFiles) {
      const content = fs.readFileSync(file, 'utf8')
      const lines = content.split('\n')
      lines.forEach((line, idx) => {
        // Exclude comments
        const cleanLine = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//, '')
        if (anyRegex.test(cleanLine)) {
          violations.push(`${path.relative(srcDir, file)}:${idx + 1}: ${line.trim()}`)
        }
      })
    }

    expect(
      violations,
      `Explicit "any" found in packages/models/src:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

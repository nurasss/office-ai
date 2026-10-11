import { describe, expect, it } from 'vitest'
import {
  parseDuration,
  parseDurationMs,
  parseDurationSeconds,
  isAppError,
} from '../src/index.js'

describe('Duration parsing (@ai-company/shared)', () => {
  it('1. Parses minutes, days, seconds, hours, ms', () => {
    expect(parseDurationMs('15m')).toBe(15 * 60 * 1000)
    expect(parseDurationMs('30d')).toBe(30 * 24 * 60 * 60 * 1000)
    expect(parseDurationMs('1h')).toBe(60 * 60 * 1000)
    expect(parseDurationMs('60s')).toBe(60 * 1000)
    expect(parseDurationMs('500ms')).toBe(500)
    expect(parseDuration('15m')).toBe(15 * 60 * 1000)
  })

  it('2. parseDurationSeconds returns integer seconds', () => {
    expect(parseDurationSeconds('15m')).toBe(900)
    expect(parseDurationSeconds('1h')).toBe(3600)
    expect(parseDurationSeconds('500ms')).toBe(0)
  })

  it('3. Invalid formats throw validationError', () => {
    expect(() => parseDuration('invalid')).toThrow()
    expect(() => parseDuration('15x')).toThrow()
    try {
      parseDuration('bad')
    } catch (err) {
      expect(isAppError(err)).toBe(true)
    }
  })
})

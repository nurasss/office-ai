import { describe, expect, it } from 'vitest'
import {
  createFixedClock,
  createFixedIdGenerator,
  realIdGenerator,
  systemClock,
  truncateToMillis,
} from '../src/index.js'

describe('clock and id', () => {
  it('truncateToMillis truncates date to millisecond precision', () => {
    const now = new Date(1771809825678)
    const truncated = truncateToMillis(now)
    expect(truncated.getTime()).toBe(1771809825678)
  })

  it('createFixedClock.advance advances time accurately', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const clock = createFixedClock(start)

    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
    clock.advance(5000)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:05.000Z')
    clock.advance(1500)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:06.500Z')
  })

  it('systemClock returns current time', () => {
    const now = systemClock.now()
    expect(now).toBeInstanceOf(Date)
    expect(Date.now() - now.getTime()).toBeLessThan(5000)
  })

  it('createFixedIdGenerator returns circular sequence of IDs', () => {
    const ids = ['id-1', 'id-2', 'id-3']
    const generator = createFixedIdGenerator(ids)

    expect(generator.next()).toBe('id-1')
    expect(generator.next()).toBe('id-2')
    expect(generator.next()).toBe('id-3')
    expect(generator.next()).toBe('id-1')
    expect(generator.next()).toBe('id-2')
  })

  it('realIdGenerator returns valid UUID v7', () => {
    const id1 = realIdGenerator.next()
    const id2 = realIdGenerator.next()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})

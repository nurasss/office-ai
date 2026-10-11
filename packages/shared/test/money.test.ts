import { describe, expect, it } from 'vitest'
import { AppError, ERROR_CODES, mulRate, Usd } from '../src/index.js'

describe('Usd and mulRate', () => {
  it('performs fromString and toString round-trip', () => {
    const values = ['1.234567', '0.000001', '100.500000', '0.000000', '-5.123456']
    for (const v of values) {
      expect(Usd.fromString(v).toString()).toBe(v)
    }
  })

  it('correctly handles addition and subtraction (including negative deltas)', () => {
    const a = Usd.fromString('10.500000')
    const b = Usd.fromString('4.250000')
    expect(a.add(b).toString()).toBe('14.750000')
    expect(a.sub(b).toString()).toBe('6.250000')
    expect(b.sub(a).toString()).toBe('-6.250000')
  })

  it('supports comparisons and isZero', () => {
    const a = Usd.fromString('1.000000')
    const b = Usd.fromString('2.000000')
    const zero = Usd.zero()

    expect(a.lt(b)).toBe(true)
    expect(b.gt(a)).toBe(true)
    expect(a.gte(a)).toBe(true)
    expect(zero.isZero()).toBe(true)
    expect(a.isZero()).toBe(false)
  })

  it('supports mulInt', () => {
    const a = Usd.fromString('2.500000')
    expect(a.mulInt(3).toString()).toBe('7.500000')
    expect(a.mulInt(-2).toString()).toBe('-5.000000')
  })

  it('has no precision loss on 1e9 microdollars ($1,000 USD)', () => {
    const micros = 1_000_000_000n
    const usd = Usd.fromMicros(micros)
    expect(usd.toMicros()).toBe(1_000_000_000n)
    expect(usd.toString()).toBe('1000.000000')
    expect(Usd.fromString('1000.000000').toMicros()).toBe(1_000_000_000n)
  })

  it('throws AppError(VALIDATION_ERROR) on invalid fromString input', () => {
    expect(() => Usd.fromString('abc')).toThrowError(AppError)
    try {
      Usd.fromString('abc')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      if (e instanceof AppError) {
        expect(e.code).toBe(ERROR_CODES.VALIDATION_ERROR)
      }
    }
  })

  it('mulRate rounds UP (ceil) to microdollars', () => {
    // 1 token at $3.00 per 1,000,000 tokens:
    // (1 * 3_000_000 + 999_999) / 1_000_000 = 3 micros = $0.000003
    const cost1 = mulRate(1, '3.000000')
    expect(cost1.toMicros()).toBe(3n)
    expect(cost1.toString()).toBe('0.000003')

    // 333333 tokens at $3.000000 per 1M:
    // 333333 * 3_000_000 = 999_999_000_000 -> 999_999 micros
    const costExact = mulRate(333333, '3.000000')
    expect(costExact.toMicros()).toBe(999_999n)
    expect(costExact.toString()).toBe('0.999999')

    // 333333 tokens at $0.010000 ($10,000 micros) per 1M:
    // 333333 * 10_000 = 3_333_330_000
    // Float division: 3333.33 micros -> ceil must produce 3334 micros ($0.003334)
    const costCeil = mulRate(333333, '0.010000')
    expect(costCeil.toMicros()).toBe(3334n)
    expect(costCeil.toString()).toBe('0.003334')

    // 0 tokens
    expect(mulRate(0, '3.000000').isZero()).toBe(true)
  })
})

import { validationError } from './errors.js'

const USD_STRING_REGEX = /^([+-]?)(\d+)(?:\.(\d{1,6}))?$/

export class Usd {
  private readonly micros: bigint

  private constructor(micros: bigint) {
    this.micros = micros
  }

  static fromString(v: string): Usd {
    const trimmed = v.trim()
    const match = USD_STRING_REGEX.exec(trimmed)
    if (!match) {
      throw validationError({ value: `Invalid USD string: '${v}'` })
    }

    const isNegative = match[1] === '-'
    const wholePart = match[2]!
    const fracPart = match[3] ?? ''
    const fracPadded = fracPart.padEnd(6, '0')

    const rawMicros = BigInt(wholePart) * 1_000_000n + BigInt(fracPadded)
    const finalMicros = isNegative ? -rawMicros : rawMicros

    return new Usd(finalMicros)
  }

  static fromMicros(v: bigint): Usd {
    return new Usd(v)
  }

  static zero(): Usd {
    return new Usd(0n)
  }

  add(o: Usd): Usd {
    return new Usd(this.micros + o.micros)
  }

  sub(o: Usd): Usd {
    return new Usd(this.micros - o.micros)
  }

  mulInt(n: number): Usd {
    if (!Number.isInteger(n)) {
      throw validationError({ n: `Multiplier must be an integer, got: ${n}` })
    }
    return new Usd(this.micros * BigInt(n))
  }

  lt(o: Usd): boolean {
    return this.micros < o.micros
  }

  gt(o: Usd): boolean {
    return this.micros > o.micros
  }

  gte(o: Usd): boolean {
    return this.micros >= o.micros
  }

  isZero(): boolean {
    return this.micros === 0n
  }

  toString(): string {
    const isNeg = this.micros < 0n
    const absMicros = isNeg ? -this.micros : this.micros
    const intPart = absMicros / 1_000_000n
    const fracPart = absMicros % 1_000_000n
    const fracStr = fracPart.toString().padStart(6, '0')
    const signStr = isNeg ? '-' : ''
    return `${signStr}${intPart.toString()}.${fracStr}`
  }

  toMicros(): bigint {
    return this.micros
  }
}

export function mulRate(tokens: number, pricePerMillionUsd: string): Usd {
  if (!Number.isInteger(tokens) || tokens < 0) {
    throw validationError({ tokens: `tokens must be a non-negative integer, got: ${tokens}` })
  }

  const priceUsd = Usd.fromString(pricePerMillionUsd)
  const priceMicros = priceUsd.toMicros()

  if (priceMicros < 0n) {
    throw validationError({ pricePerMillionUsd: 'pricePerMillionUsd cannot be negative' })
  }

  if (tokens === 0 || priceMicros === 0n) {
    return Usd.zero()
  }

  const numerator = BigInt(tokens) * priceMicros
  const denominator = 1_000_000n
  const resultMicros = (numerator + denominator - 1n) / denominator

  return Usd.fromMicros(resultMicros)
}

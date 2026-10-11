import { validationError } from './errors.js'

const DURATION_REGEX = /^(\d+)(ms|s|m|h|d|w)?$/i

/**
 * Parses a duration string (e.g. '15m', '30d', '1h', '60s', '500ms') into milliseconds.
 */
export function parseDurationMs(duration: string): number {
  const match = duration.trim().match(DURATION_REGEX)
  if (!match) {
    throw validationError({ duration: `Invalid duration format: '${duration}'` })
  }

  const value = parseInt(match[1]!, 10)
  const unit = (match[2] ?? 'ms').toLowerCase()

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    case 'w':
      return value * 7 * 24 * 60 * 60 * 1000
    default:
      throw validationError({ duration: `Unsupported duration unit: '${unit}'` })
  }
}

/**
 * Parses a duration string into seconds (floored).
 */
export function parseDurationSeconds(duration: string): number {
  return Math.floor(parseDurationMs(duration) / 1000)
}

/**
 * Default parseDuration returns milliseconds.
 */
export const parseDuration = parseDurationMs

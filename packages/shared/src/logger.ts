import pino, { type Logger as PinoLogger } from 'pino'
import { env } from './env.js'

export type Logger = PinoLogger

const redactPaths = [
  // Deep explicit paths for request/response bodies and sensitive headers
  'req.body.password',
  'req.body.value',
  'req.body.apiKey',
  'res.headers["set-cookie"]',
  'req.headers.authorization',
  'req.headers.cookie',
  // Wildcard paths for top/single-nested object keys.
  // Known limitation: wildcard paths in pino work only on a single nesting level (e.g. *.secret).
  // Therefore, deep objects containing secrets must never be logged directly.
  '*.apiKey',
  '*.password',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.value_encrypted',
  '*.passwordHash',
]

export const rootLogger: Logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
})

export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return rootLogger.child(bindings)
}

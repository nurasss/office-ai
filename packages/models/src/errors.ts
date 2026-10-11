import { AppError } from '@ai-company/shared'

export type ProviderErrorKind =
  | 'rate_limit'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'auth'
  | 'invalid_request'
  | 'context_length'
  | 'content_filter'
  | 'unknown'

export class ProviderError extends AppError {
  readonly kind: ProviderErrorKind
  readonly provider: string
  readonly retryAfterMs?: number | undefined

  constructor(opts: {
    kind: ProviderErrorKind
    provider: string
    message: string
    retryAfterMs?: number
    details?: Record<string, unknown>
  }) {
    super({
      code: 'PROVIDER_ERROR',
      httpStatus: opts.kind === 'rate_limit' ? 429 : 502,
      message: opts.message,
      details: {
        kind: opts.kind,
        provider: opts.provider,
        ...(opts.retryAfterMs !== undefined ? { retryAfterMs: opts.retryAfterMs } : {}),
        ...opts.details,
      },
    })
    this.kind = opts.kind
    this.provider = opts.provider
    this.retryAfterMs = opts.retryAfterMs
  }
}

export function isRetryableErrorKind(kind: ProviderErrorKind): boolean {
  switch (kind) {
    case 'rate_limit':
    case 'overloaded':
    case 'timeout':
    case 'network':
    case 'server_error':
      return true
    case 'auth':
    case 'invalid_request':
    case 'context_length':
    case 'content_filter':
    case 'unknown':
    default:
      return false
  }
}

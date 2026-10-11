import type { Clock, Logger } from '@ai-company/shared'
import { isRetryableErrorKind, ProviderError } from './errors.js'

export interface RetryPolicy {
  maxAttempts: number // default 3, i.e. up to 2 retries
  baseDelayMs: number // default 500
  maxDelayMs: number // default 20000
  jitter: boolean // default true
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 20000,
  jitter: true,
}

export interface RetryDeps {
  clock: Clock
  sleep: (ms: number) => Promise<void>
  logger: Logger
  random?: () => number
  onAttemptError?: (attempt: number, error: unknown, delayMs: number) => void
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  deps: RetryDeps,
): Promise<T> {
  const mergedPolicy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    ...policy,
  }

  const randomFn = deps.random ?? Math.random
  let attempt = 1

  while (true) {
    try {
      return await fn(attempt)
    } catch (err: unknown) {
      const isRetryable = err instanceof ProviderError && isRetryableErrorKind(err.kind)
      if (!isRetryable || attempt >= mergedPolicy.maxAttempts) {
        throw err
      }

      let delayMs: number
      if (err instanceof ProviderError && err.retryAfterMs !== undefined && err.retryAfterMs > 0) {
        delayMs = err.retryAfterMs
      } else {
        const expDelay = Math.min(
          mergedPolicy.maxDelayMs,
          mergedPolicy.baseDelayMs * Math.pow(2, attempt - 1),
        )
        if (mergedPolicy.jitter) {
          delayMs = Math.floor(randomFn() * expDelay)
        } else {
          delayMs = expDelay
        }
      }

      deps.logger.warn({
        msg: 'Model call attempt failed, retrying',
        kind: err.kind,
        attempt,
        delayMs,
        provider: err.provider,
      })

      if (deps.onAttemptError) {
        deps.onAttemptError(attempt, err, delayMs)
      }

      await deps.sleep(delayMs)
      attempt++
    }
  }
}

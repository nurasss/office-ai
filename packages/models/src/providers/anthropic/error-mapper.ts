import { ProviderError, type ProviderErrorKind } from '../../errors.js'

export function mapAnthropicError(err: unknown, signal?: AbortSignal): ProviderError {
  if (err instanceof ProviderError) {
    return err
  }

  if (
    signal?.aborted ||
    (err instanceof Error &&
      (err.name === 'AbortError' ||
        err.name === 'TimeoutError' ||
        err.name === 'APIUserAbortError' ||
        err.name === 'APIConnectionTimeoutError'))
  ) {
    return new ProviderError({
      kind: 'timeout',
      provider: 'anthropic',
      message: 'Request timed out or was aborted',
    })
  }

  const maybeStatus =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { status?: number; statusCode?: number }).statusCode

  const maybeHeaders = (err as { headers?: Record<string, string> | Headers }).headers
  let retryAfterMs: number | undefined

  if (maybeHeaders) {
    let headerVal: string | null | undefined
    if (typeof (maybeHeaders as Headers).get === 'function') {
      headerVal = (maybeHeaders as Headers).get('retry-after')
    } else if (typeof maybeHeaders === 'object') {
      headerVal = (maybeHeaders as Record<string, string>)['retry-after']
    }
    if (headerVal) {
      const parsedSeconds = parseFloat(headerVal)
      if (!isNaN(parsedSeconds) && parsedSeconds >= 0) {
        retryAfterMs = Math.round(parsedSeconds * 1000)
      }
    }
  }

  const rawApiError = (err as { error?: { message?: string; type?: string } }).error
  const errorMessage =
    rawApiError?.message ?? (err as Error)?.message ?? 'Anthropic provider error'
  const errorType = rawApiError?.type?.toLowerCase() ?? ''

  if (typeof maybeStatus === 'number' && maybeStatus >= 400) {
    let kind: ProviderErrorKind
    switch (maybeStatus) {
      case 401:
      case 403:
        kind = 'auth'
        break
      case 400:
        if (
          errorType.includes('context_length') ||
          errorType.includes('max_tokens') ||
          errorMessage.toLowerCase().includes('prompt is too long') ||
          errorMessage.toLowerCase().includes('context length') ||
          errorMessage.toLowerCase().includes('max tokens') ||
          errorMessage.toLowerCase().includes('prompt exceeds')
        ) {
          kind = 'context_length'
        } else {
          kind = 'invalid_request'
        }
        break
      case 404:
        kind = 'invalid_request'
        break
      case 413:
        kind = 'context_length'
        break
      case 429:
        kind = 'rate_limit'
        break
      case 500:
      case 502:
      case 503:
        kind = 'server_error'
        break
      case 529:
        kind = 'overloaded'
        break
      default:
        kind = 'unknown'
        break
    }

    return new ProviderError({
      kind,
      provider: 'anthropic',
      message: errorMessage,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    })
  }

  const code =
    (err as { code?: string }).code ??
    (err as { cause?: { code?: string } }).cause?.code
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    code === 'ECONNABORTED' ||
    (err instanceof Error &&
      (err.name === 'APIConnectionError' ||
        err.name === 'FetchError' ||
        err.message.toLowerCase().includes('fetch failed') ||
        err.message.toLowerCase().includes('network') ||
        err.message.toLowerCase().includes('socket hang up') ||
        err.message.toLowerCase().includes('terminated') ||
        err.message.toLowerCase().includes('premature') ||
        err.message.toLowerCase().includes('destroyed') ||
        err.message.toLowerCase().includes('stream') ||
        err.message.toLowerCase().includes('closed') ||
        err.message.toLowerCase().includes('connection error')))
  ) {
    return new ProviderError({
      kind: 'network',
      provider: 'anthropic',
      message: errorMessage,
    })
  }

  return new ProviderError({
    kind: 'unknown',
    provider: 'anthropic',
    message: errorMessage,
  })
}

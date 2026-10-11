export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  ORG_NOT_SELECTED: 'ORG_NOT_SELECTED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  SLUG_ALREADY_EXISTS: 'SLUG_ALREADY_EXISTS',
  LAST_OWNER: 'LAST_OWNER',
  DEPARTMENT_CYCLE: 'DEPARTMENT_CYCLE',
  AGENT_CYCLE: 'AGENT_CYCLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export interface AppErrorOptions {
  code: string
  httpStatus: number
  message: string
  details?: Record<string, unknown> | undefined
  retryable?: boolean | undefined
  cause?: unknown
}

export class AppError extends Error {
  readonly code: string
  readonly httpStatus: number
  readonly details?: Record<string, unknown> | undefined
  readonly retryable: boolean

  constructor(opts: AppErrorOptions) {
    super(opts.message, { cause: opts.cause })
    this.name = 'AppError'
    this.code = opts.code
    this.httpStatus = opts.httpStatus
    this.details = opts.details
    this.retryable = opts.retryable ?? false
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toResponse(requestId: string): {
    error: {
      code: string
      message: string
      details?: Record<string, unknown> | undefined
      requestId: string
    }
  } {
    const errorObj: {
      code: string
      message: string
      details?: Record<string, unknown> | undefined
      requestId: string
    } = {
      code: this.code,
      message: this.message,
      requestId,
    }

    if (this.details !== undefined) {
      errorObj.details = this.details
    }

    return { error: errorObj }
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}

export function notFound(resource: string, id: string): AppError {
  return new AppError({
    code: ERROR_CODES.NOT_FOUND,
    httpStatus: 404,
    message: `${resource} with id '${id}' not found`,
    details: { resource, id },
  })
}

export function unauthorized(code: string = ERROR_CODES.UNAUTHORIZED): AppError {
  return new AppError({
    code,
    httpStatus: 401,
    message: 'Unauthorized',
  })
}

export function forbidden(reason: string = 'Forbidden'): AppError {
  return new AppError({
    code: ERROR_CODES.FORBIDDEN,
    httpStatus: 403,
    message: reason,
  })
}

export function validationError(issues: unknown): AppError {
  return new AppError({
    code: ERROR_CODES.VALIDATION_ERROR,
    httpStatus: 400,
    message: 'Validation failed',
    details: { issues },
  })
}

export function conflict(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return new AppError({
    code,
    httpStatus: 409,
    message,
    details,
  })
}

export function internal(cause?: unknown): AppError {
  return new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    httpStatus: 500,
    message: 'Internal server error',
    cause,
  })
}

export function rateLimited(retryAfterSec: number): AppError {
  return new AppError({
    code: ERROR_CODES.RATE_LIMITED,
    httpStatus: 429,
    message: `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`,
    retryable: true,
    details: { retryAfterSec },
  })
}

export type ServiceErrorCode =
  | 'BACKEND_NOT_CONNECTED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_VERIFIED'
  | 'REFERENCE_MISMATCH'
  | 'NO_ADMISSION_RECORD'
  | 'AMBIGUOUS_ADMISSION_RECORD'
  | 'INVALID_QR'
  | 'INVALID_RESPONSE'
  | 'VALIDATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_DISABLED'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'EMAIL_PROVIDER_NOT_CONFIGURED'
  | 'EMAIL_DELIVERY_FAILED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'IMPORT_ALREADY_PROCESSED'
  | 'IMPORT_PREVIEW_EXPIRED'
  | 'IMPORT_STALE'
  | 'NETWORK'
  | 'UNKNOWN'

/** Per-field messages from the backend's VALIDATION_FAILED responses. */
export type FieldErrors = { field: string; messages: string[] }[]

/** Errors with a student-friendly `message`; never contains stack traces or raw server output. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode
  readonly details?: FieldErrors

  constructor(code: ServiceErrorCode, message: string, details?: FieldErrors) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.details = details
  }
}

export const notConnected = (what: string) =>
  new ServiceError('BACKEND_NOT_CONNECTED', `${what} isn’t connected yet. This will work once the CampusGuide server is connected.`)

export const errorMessage = (error: unknown, fallback = 'Something went wrong. Please try again.') =>
  error instanceof ServiceError ? error.message : fallback

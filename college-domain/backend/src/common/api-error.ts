import { HttpException, HttpStatus } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** Stable, machine-readable error codes. The frontend switches on `code`; `message` is shown to students. */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_DISABLED'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'EMAIL_PROVIDER_NOT_CONFIGURED'
  | 'EMAIL_DELIVERY_FAILED'
  | 'FORBIDDEN_ORIGIN'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_QR'
  | 'NOT_VERIFIED'
  | 'REFERENCE_MISMATCH'
  | 'NO_ADMISSION_RECORD'
  | 'AMBIGUOUS_ADMISSION_RECORD'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FILE'
  | 'IMPORT_ALREADY_PROCESSED'
  | 'IMPORT_PREVIEW_EXPIRED'
  | 'IMPORT_STALE'
  | 'ASSISTANT_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export type FieldError = { field: string; messages: string[] }

export class ApiError extends HttpException {
  constructor(status: HttpStatus, readonly code: ApiErrorCode, message: string, readonly details?: FieldError[]) {
    super({ code, message, details }, status)
  }
}

/** Shape of every error response (documented in Swagger). */
export class ErrorResponseDto {
  @ApiProperty({ example: 401 }) statusCode: number
  @ApiProperty({ example: 'UNAUTHENTICATED' }) code: string
  @ApiProperty({ example: 'Sign in to continue.' }) message: string
  @ApiPropertyOptional({ example: [{ field: 'email', messages: ['email must be an email'] }] }) details?: FieldError[]
  @ApiProperty({ example: '6f1c2c1e-1f2a-4b8f-9a55-0e7d4f6b2a10' }) requestId: string
}

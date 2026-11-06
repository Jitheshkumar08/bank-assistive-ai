import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Prisma } from '../generated/prisma/client.js'
import { ApiError, type ApiErrorCode, type FieldError } from './api-error.js'

const defaultCodes: Partial<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'FILE_TOO_LARGE', 429: 'RATE_LIMITED',
}

/**
 * Converts every error into { statusCode, code, message, details?, requestId }.
 * Unexpected errors are logged with the request id (no bodies, cookies or headers) and returned as a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors')

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp()
    const request = http.getRequest<Request & { id?: string }>()
    const response = http.getResponse<Response>()
    const requestId = request.id ?? 'unknown'
    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code: ApiErrorCode = 'INTERNAL_ERROR'
    let message = 'Something went wrong. Please try again later.'
    let details: FieldError[] | undefined

    if (exception instanceof ApiError) {
      status = exception.getStatus(); code = exception.code; message = exception.message; details = exception.details
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT; code = 'CONFLICT'; message = 'This request conflicts with existing data. Please try again.'
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      code = defaultCodes[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED')
      const body = exception.getResponse()
      if (status < 500) message = typeof body === 'object' && body && 'message' in body && typeof body.message === 'string' ? body.message : exception.message
      // Malformed JSON bodies surface as 400 from the body parser.
      if (status === 400 && /JSON/i.test(message)) message = 'The request body is not valid JSON.'
      // Upload size limit (multer) — the limit itself is stated by the endpoint documentation and the UI.
      if (status === 413) message = 'The file is too large.'
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.path} failed [${requestId}]`, exception instanceof Error ? exception.stack : String(exception))
    }
    response.status(status).json({ statusCode: status, code, message, ...(details ? { details } : {}), requestId })
  }
}

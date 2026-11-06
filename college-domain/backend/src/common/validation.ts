import { HttpStatus, ValidationPipe, type ValidationError } from '@nestjs/common'
import { ApiError, type FieldError } from './api-error.js'

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : []
    return [...own, ...flatten(error.children ?? [], field)]
  })
}

/** Strict DTO validation: unknown properties are rejected, values are transformed to DTO types. */
export const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: false,
  exceptionFactory: (errors) => new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Some fields are missing or invalid.', flatten(errors)),
})

import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { ApiError } from '../common/api-error.js'
import { SessionService, type AuthenticatedAccount } from './session.service.js'

type AuthedRequest = Request & { student?: AuthenticatedAccount }

/** Requires a valid session for an active, email-verified account. Identity and role come only from the session cookie. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthedRequest>()
    const student = await this.sessions.resolve(request.cookies?.[this.sessions.cookieName])
    if (!student) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.')
    request.student = student
    return true
  }
}

/** The signed-in account established by SessionGuard. */
export const CurrentStudent = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedAccount => {
  return context.switchToHttp().getRequest<AuthedRequest>().student!
})

/** Same as CurrentStudent; reads better on staff endpoints. */
export const CurrentAccount = CurrentStudent

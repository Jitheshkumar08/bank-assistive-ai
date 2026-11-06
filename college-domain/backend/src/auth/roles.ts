import { applyDecorators, CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata, UseGuards } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApiCookieAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { ApiError, ErrorResponseDto } from '../common/api-error.js'
import type { AccountRole, AuditActorType } from '../generated/prisma/client.js'
import { SessionGuard } from './session.guard.js'
import type { AuthenticatedAccount } from './session.service.js'

const ROLES_KEY = 'campusguide:roles'

/**
 * Authorises by the role stored on the account (resolved server-side from the session on every request).
 * Runs after SessionGuard; an authenticated account with another role gets 403 FORBIDDEN.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<AccountRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!roles?.length) return true
    const account = context.switchToHttp().getRequest<Request & { student?: AuthenticatedAccount }>().student
    if (!account || !roles.includes(account.role)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have permission to do this.')
    }
    return true
  }
}

/** Requires a signed-in account with one of `roles`. Use on controllers or handlers. */
export const Auth = (...roles: AccountRole[]) => applyDecorators(
  SetMetadata(ROLES_KEY, roles),
  UseGuards(SessionGuard, RolesGuard),
  ApiCookieAuth('session'),
  ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'UNAUTHENTICATED' }),
  ApiForbiddenResponse({ type: ErrorResponseDto, description: `FORBIDDEN — requires role ${roles.join(' or ')}` }),
)

/** Audit actor type for an account role. */
export const actorTypeFor = (role: AccountRole): AuditActorType =>
  role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : role === 'COLLEGE_ADMIN' ? 'ADMIN' : 'STUDENT'

/** A College Admin acts only within their own college. */
export function requireInstitution(account: AuthenticatedAccount) {
  if (!account.institutionId) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Your account is not assigned to a college. Contact the CampusGuide Super Admin.')
  return account.institutionId
}

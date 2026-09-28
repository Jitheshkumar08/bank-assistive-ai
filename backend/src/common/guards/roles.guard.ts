import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser, UserRole } from '../../auth/types/jwt-payload.type';

/**
 * Registered globally, and does nothing until a route asks for a role.
 *
 * Runs after the JWT guard, so `request.user` is the account the token
 * resolved to -- re-read from the database on every request, never the
 * token's own claims.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user || !required.includes(user.role)) {
      // Deliberately vague: an ordinary customer poking at an admin URL
      // learns only that it is not for them.
      throw new ForbiddenException('You do not have access to this area.');
    }

    return true;
  }
}

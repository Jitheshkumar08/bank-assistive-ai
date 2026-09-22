import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../auth/types/jwt-payload.type';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route, or a whole controller, to certain roles.
 *
 * Authentication still comes first: the global JWT guard puts the
 * account on the request, and this only decides whether that account is
 * allowed here. A route without this decorator is open to any signed-in
 * customer, exactly as before.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

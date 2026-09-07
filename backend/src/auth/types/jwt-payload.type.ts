/** Claims carried inside an access token. */
export interface JwtPayload {
  /** Subject: the user's id. */
  sub: string;
  email: string;
  /** Issued-at and expiry, added by @nestjs/jwt. */
  iat?: number;
  exp?: number;
}

/**
 * The authenticated user as attached to the request.
 *
 * Deliberately excludes passwordHash. Nothing downstream should be able
 * to read a hash off the request object.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  preferredLanguage: string;
}

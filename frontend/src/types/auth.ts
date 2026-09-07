export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  preferredLanguage: string;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: string;
  user: AuthenticatedUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  fullName: string;
  password: string;
  phone?: string;
  preferredLanguage?: string;
}

/**
 * Changes to the signed-in account.
 *
 * Every field optional: sending only what changed means a form can
 * never overwrite a field it did not touch. `currentPassword` is
 * required by the API only when the email changes.
 */
export interface UpdateProfileRequest {
  fullName?: string;
  email?: string;
  preferredLanguage?: string;
  currentPassword?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

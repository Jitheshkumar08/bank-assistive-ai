/**
 * What an account may do.
 *
 * Only the staff account named by the API's ADMIN_EMAIL is ever ADMIN;
 * registering always produces a CUSTOMER.
 */
export type UserRole = 'CUSTOMER' | 'ADMIN';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  preferredLanguage: string;
  role: UserRole;
  /**
   * Whether the welcome screen may offer this customer their remembered
   * payments. On the account rather than this device, so turning it off
   * on a branch tablet also turns it off on their own phone.
   */
  suggestionsEnabled: boolean;
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
  suggestionsEnabled?: boolean;
  currentPassword?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

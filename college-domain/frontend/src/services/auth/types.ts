/** What the login form sends. `rememberMe` asks the server for a longer-lived session; nothing is stored client-side. */
export type LoginCredentials = {
  email: string
  password: string
  rememberMe: boolean
}

/** Returned by the backend after sign-in. The session token stays in an HttpOnly cookie, so none appears here. */
export type AuthSession = {
  user: { id: string; email: string; displayName?: string; role?: 'STUDENT' | 'COLLEGE_ADMIN' | 'SUPER_ADMIN' }
}

export type AuthErrorCode =
  | 'BACKEND_NOT_CONNECTED' | 'INVALID_CREDENTIALS' | 'EMAIL_NOT_VERIFIED' | 'ACCOUNT_DISABLED' | 'RATE_LIMITED' | 'NETWORK' | 'UNKNOWN'

/** Errors the UI can show as-is: `message` is written for students, never containing internal detail. */
export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

/** The single seam the login form depends on. */
export interface AuthService {
  login(credentials: LoginCredentials): Promise<AuthSession>
}

/**
 * Account lifecycle: registration, email verification and password reset. Every method resolves only when the backend
 * accepted the request; `message` is the server's (deliberately generic) answer. Failures throw `ServiceError`.
 */
export interface AccountService {
  register(input: { email: string; password: string }): Promise<{ message: string }>
  resendVerification(email: string): Promise<{ message: string }>
  verifyEmail(token: string): Promise<void>
  forgotPassword(email: string): Promise<{ message: string }>
  resetPassword(input: { token: string; password: string }): Promise<void>
}

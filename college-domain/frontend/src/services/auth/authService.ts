import { config } from '../../config'
import { notConnected, ServiceError } from '../errors'
import { apiRequest } from '../http'
import { parseStudent } from './sessionService'
import { AuthError, type AccountService, type AuthErrorCode, type AuthService } from './types'

/**
 * Used when no backend is configured (VITE_API_BASE_URL empty).
 * It never checks, stores or transmits credentials and never reports success: every attempt is rejected with a
 * clear "not connected" error.
 */
export const backendPendingAuthService: AuthService = {
  async login() {
    throw new AuthError(
      'BACKEND_NOT_CONNECTED',
      'Sign-in is not available yet. Student accounts will be connected to the CampusGuide server in a later release, so you have not been signed in.',
    )
  },
}

const passThrough = new Set<AuthErrorCode>(['INVALID_CREDENTIALS', 'EMAIL_NOT_VERIFIED', 'ACCOUNT_DISABLED', 'RATE_LIMITED', 'NETWORK'])

/** POST /auth/login: the server sets the HttpOnly session cookie and returns the public student profile. */
export const httpAuthService: AuthService = {
  async login(credentials) {
    try {
      const body = await apiRequest<{ student?: unknown }>('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }, 'Student sign-in')
      const user = parseStudent(body?.student)
      if (!user) throw new AuthError('UNKNOWN', 'Sign-in failed. Please try again.')
      return { user: { id: user.id, email: user.email, role: user.role, ...(user.displayName ? { displayName: user.displayName } : {}) } }
    } catch (error) {
      if (error instanceof AuthError) throw error
      if (error instanceof ServiceError) {
        const code = passThrough.has(error.code as AuthErrorCode) ? error.code as AuthErrorCode : 'UNKNOWN'
        throw new AuthError(code, code === 'UNKNOWN' && error.code !== 'VALIDATION_FAILED' ? 'Something went wrong while signing you in. Please try again in a moment.' : error.message)
      }
      throw error
    }
  },
}

const accountUnavailable = () => notConnected('Student accounts')

export const backendPendingAccountService: AccountService = {
  async register() { throw accountUnavailable() },
  async resendVerification() { throw accountUnavailable() },
  async verifyEmail() { throw accountUnavailable() },
  async forgotPassword() { throw accountUnavailable() },
  async resetPassword() { throw accountUnavailable() },
}

function messageOf(body: unknown) {
  const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined
  if (typeof message !== 'string' || !message.trim()) throw new ServiceError('INVALID_RESPONSE', 'CampusGuide returned an unexpected answer. Please try again.')
  return { message }
}

const post = (path: string, body: unknown) => apiRequest<unknown>(path, { method: 'POST', body: JSON.stringify(body) }, 'Student accounts')

export const httpAccountService: AccountService = {
  async register(input) { return messageOf(await post('/auth/register', input)) },
  async resendVerification(email) { return messageOf(await post('/auth/resend-verification', { email })) },
  async verifyEmail(token) {
    const body = await post('/auth/verify-email', { token }) as { verified?: unknown } | null
    if (body?.verified !== true) throw new ServiceError('INVALID_RESPONSE', 'Your email could not be confirmed. Please try again.')
  },
  async forgotPassword(email) { return messageOf(await post('/auth/forgot-password', { email })) },
  async resetPassword(input) {
    const body = await post('/auth/reset-password', input) as { passwordReset?: unknown } | null
    if (body?.passwordReset !== true) throw new ServiceError('INVALID_RESPONSE', 'Your password could not be changed. Please try again.')
  },
}

export const authService: AuthService = config.apiBaseUrl ? httpAuthService : backendPendingAuthService
export const accountService: AccountService = config.apiBaseUrl ? httpAccountService : backendPendingAccountService

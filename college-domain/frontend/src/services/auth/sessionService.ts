import { config } from '../../config'
import { notConnected, ServiceError } from '../errors'
import { apiRequest } from '../http'

export type AccountRole = 'STUDENT' | 'COLLEGE_ADMIN' | 'SUPER_ADMIN'

/**
 * The signed-in account. `role` comes from the backend's database record and only decides which portal the UI shows;
 * the backend authorises every request itself. Students have no `displayName` (their names come from official records).
 */
export type SessionUser = { id: string; email: string; displayName: string | null; role: AccountRole }

const roles: readonly AccountRole[] = ['STUDENT', 'COLLEGE_ADMIN', 'SUPER_ADMIN']

export interface SessionService {
  /** The signed-in student from the server session, or null when signed out. */
  getSession(): Promise<SessionUser | null>
  logout(): Promise<void>
}

/** Validates the backend's public account object ({ id, email, emailVerified, createdAt, role, displayName }). */
export function parseStudent(value: unknown): SessionUser | null {
  const student = value && typeof value === 'object' ? value as { id?: unknown; email?: unknown; role?: unknown; displayName?: unknown } : null
  if (!student || typeof student.id !== 'string' || typeof student.email !== 'string') return null
  // An unknown or missing role never unlocks a staff portal.
  const role = roles.includes(student.role as AccountRole) ? student.role as AccountRole : 'STUDENT'
  const displayName = typeof student.displayName === 'string' && student.displayName.trim() ? student.displayName.trim() : null
  return { id: student.id, email: student.email, displayName: role === 'STUDENT' ? null : displayName, role }
}

export const backendPendingSessionService: SessionService = {
  async getSession() { throw notConnected('Student sign-in') },
  async logout() {},
}

export const httpSessionService: SessionService = {
  async getSession() {
    try {
      const body = await apiRequest<{ student?: unknown }>('/auth/me', {}, 'Student sign-in')
      return parseStudent(body?.student)
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'UNAUTHENTICATED') return null
      throw error
    }
  },
  async logout() {
    await apiRequest('/auth/logout', { method: 'POST' }, 'Student sign-in')
  },
}

export const sessionService: SessionService = config.apiBaseUrl ? httpSessionService : backendPendingSessionService

import { ServiceError } from '../errors'
import { apiRequest } from '../http'
import type { AccountRole } from './sessionService'

export type InvitationInfo = {
  email: string
  displayName: string
  role: Exclude<AccountRole, 'STUDENT'>
  collegeName: string | null
  expiresAt: string
  passwordMinLength: number
}

/** Staff activation behind the emailed single-use link. The role is decided by the invitation on the server. */
export interface InvitationService {
  inspect(token: string): Promise<InvitationInfo>
  accept(token: string, password: string): Promise<{ role: AccountRole }>
}

const what = 'Staff account activation'

export const httpInvitationService: InvitationService = {
  async inspect(token) {
    const body = await apiRequest<Partial<InvitationInfo>>('/auth/invitations/inspect', { method: 'POST', body: JSON.stringify({ token }) }, what)
    if (typeof body?.email !== 'string' || (body.role !== 'COLLEGE_ADMIN' && body.role !== 'SUPER_ADMIN') || typeof body.passwordMinLength !== 'number') {
      throw new ServiceError('INVALID_RESPONSE', 'CampusGuide returned an unexpected answer. Please try again.')
    }
    return body as InvitationInfo
  },
  async accept(token, password) {
    const body = await apiRequest<{ activated?: unknown; role?: unknown }>('/auth/invitations/accept', { method: 'POST', body: JSON.stringify({ token, password }) }, what)
    if (body?.activated !== true) throw new ServiceError('INVALID_RESPONSE', 'Your account could not be activated. Please try again.')
    return { role: body.role as AccountRole }
  },
}

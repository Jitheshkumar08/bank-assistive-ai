import { apiRequest } from '../http'
import { qrCodeReader, queryString } from './adminService'
import type { AuditEntry, CollegeAdminAccount, Paged, QrCodeReader, QrPlacement, StaffInvitation, SuperAdminOverview } from './adminTypes'

/** Super Admin API: College Admin accounts, invitations and the audit log. Authorised server-side on every call. */
export interface SuperAdminService {
  overview(): Promise<SuperAdminOverview>
  collegeAdmins(): Promise<{ accounts: CollegeAdminAccount[]; invitations: StaffInvitation[] }>
  invite(input: { displayName: string; email: string; institutionId: string }): Promise<{ id: string; email: string; displayName: string; expiresAt: string }>
  resendInvitation(id: string): Promise<{ id: string; expiresAt: string }>
  revokeInvitation(id: string): Promise<{ id: string }>
  suspend(id: string, reason?: string): Promise<{ id: string; status: string }>
  restore(id: string, reason?: string): Promise<{ id: string; status: string }>
  auditEvents(query: { page?: number; pageSize?: number; actorType?: string; action?: string; entityType?: string }): Promise<Paged<AuditEntry>>
  /** QR Management: every college's placements, plus creating and activating / deactivating them. */
  qrCodes: QrCodeReader & {
    create(input: { institutionId: string; areaSlug: string; label: string }): Promise<QrPlacement>
    setActive(id: string, active: boolean): Promise<QrPlacement>
  }
}

const what = 'The Super Admin portal'
const post = <T>(path: string, body: unknown = {}) => apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) }, what)
const id = (value: string) => encodeURIComponent(value)

export const httpSuperAdminService: SuperAdminService = {
  overview: () => apiRequest('/super-admin/overview', {}, what),
  collegeAdmins: () => apiRequest('/super-admin/college-admins', {}, what),
  invite: (input) => post('/super-admin/college-admins/invitations', input),
  resendInvitation: (invitationId) => post(`/super-admin/college-admins/invitations/${id(invitationId)}/resend`),
  revokeInvitation: (invitationId) => post(`/super-admin/college-admins/invitations/${id(invitationId)}/revoke`),
  suspend: (accountId, reason) => post(`/super-admin/college-admins/${id(accountId)}/suspend`, reason ? { reason } : {}),
  restore: (accountId, reason) => post(`/super-admin/college-admins/${id(accountId)}/restore`, reason ? { reason } : {}),
  auditEvents: (query) => apiRequest(`/super-admin/audit-events${queryString(query)}`, {}, what),
  qrCodes: {
    ...qrCodeReader('/super-admin/qr-codes', what),
    create: (input) => post('/super-admin/qr-codes', input),
    setActive: (placementId, active) => post(`/super-admin/qr-codes/${id(placementId)}/${active ? 'activate' : 'deactivate'}`),
  },
}

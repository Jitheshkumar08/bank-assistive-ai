import type { PrismaService } from '../prisma/prisma.service.js'

type EventRow = { id: string; actorType: string; actorId: string | null; action: string; entityType: string; entityId: string | null; metadata: unknown; createdAt: Date }

/** Human-readable descriptions for the audit actions shown in the admin UIs. */
const descriptions: Record<string, string> = {
  COLLEGE_ADMIN_INVITED: 'Invited a College Admin',
  STAFF_INVITATION_RESENT: 'Resent a staff invitation',
  STAFF_INVITATION_REVOKED: 'Revoked a staff invitation',
  COLLEGE_ADMIN_ACTIVATED: 'Activated a College Admin account',
  SUPER_ADMIN_ACTIVATED: 'Activated the Super Admin account',
  SUPER_ADMIN_BOOTSTRAP_INVITED: 'Started Super Admin provisioning',
  STAFF_ACCESS_SUSPENDED: 'Suspended staff access',
  STAFF_ACCESS_RESTORED: 'Restored staff access',
  ADMISSION_IMPORT_PREVIEWED: 'Uploaded an admission file for review',
  ADMISSION_IMPORT_COMMITTED: 'Imported admission records',
  ADMISSION_IMPORT_FAILED: 'An admission import failed',
  ADMISSION_IMPORT_CANCELLED: 'Cancelled an admission import',
  ADMISSION_RECORD_EDITED: 'Edited an admission record',
  ADMISSION_RECORD_CREATED_BY_IMPORT: 'Created by import',
  ADMISSION_RECORD_UPDATED_BY_IMPORT: 'Updated by import',
  ADMISSION_RECORD_VERIFIED: 'Student verified their record',
  LOGIN_SUCCEEDED: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in attempt',
  ACCOUNT_TEMPORARILY_LOCKED: 'Account temporarily locked',
  PASSWORD_RESET_REQUESTED: 'Requested a password reset',
  PASSWORD_RESET_COMPLETED: 'Reset their password',
  QR_PLACEMENT_CREATED: 'Created a QR placement',
  QR_PLACEMENT_ACTIVATED: 'Activated a QR placement',
  QR_PLACEMENT_DEACTIVATED: 'Deactivated a QR placement',
}

export const describeAction = (action: string) => descriptions[action] ?? action.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/**
 * Adds a readable actor label to audit events. Staff are labelled by display name; students only as "Student"
 * (admin views don't need their email).
 */
export async function presentAuditEvents(prisma: PrismaService, events: EventRow[]) {
  const ids = [...new Set(events.map((event) => event.actorId).filter((id): id is string => Boolean(id)))]
  const accounts = ids.length
    ? await prisma.studentAccount.findMany({ where: { id: { in: ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) } }, select: { id: true, role: true, displayName: true, email: true } })
    : []
  const byId = new Map(accounts.map((account) => [account.id, account]))
  return events.map((event) => {
    const actor = event.actorId ? byId.get(event.actorId) : undefined
    const actorName = event.actorType === 'SYSTEM' ? 'System'
      : actor && actor.role !== 'STUDENT' ? (actor.displayName ?? actor.email)
      : event.actorType === 'STUDENT' ? 'Student' : 'Unknown account'
    return {
      id: event.id, action: event.action, description: describeAction(event.action), actorType: event.actorType, actorName,
      entityType: event.entityType, entityId: event.entityId, metadata: event.metadata ?? null, createdAt: event.createdAt.toISOString(),
    }
  })
}

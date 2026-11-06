import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { PasswordService } from '../auth/password.service.js'
import { actorTypeFor } from '../auth/roles.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { generateToken, hashToken, normalizeEmail } from '../auth/tokens.js'
import { ApiError } from '../common/api-error.js'
import { AppConfig } from '../config/app-config.service.js'
import { deliverEmail, requireEmailSender } from '../email/email-delivery.js'
import { EMAIL_SENDER, type EmailSender } from '../email/email.types.js'
import type { AccountRole } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { staffInvitationEmail } from './staff.emails.js'

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000
/** Minimum password length when activating each staff role (students: 12, enforced by RegisterDto). */
export const STAFF_PASSWORD_MIN: Record<Exclude<AccountRole, 'STUDENT'>, number> = { COLLEGE_ADMIN: 12, SUPER_ADMIN: 16 }

export type InvitationState = 'pending' | 'expired' | 'revoked' | 'accepted'

export const invitationState = (invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InvitationState =>
  invitation.acceptedAt ? 'accepted' : invitation.revokedAt ? 'revoked' : invitation.expiresAt <= now ? 'expired' : 'pending'

const invalidToken = () => new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_OR_EXPIRED_TOKEN', 'This activation link is invalid, has expired or was already used. Ask the CampusGuide Super Admin for a new one.')

/**
 * Staff access: invitations are the only way to obtain a staff role. The account itself is created when the invited
 * person opens the single-use link and sets a password (which also proves the email address).
 */
@Injectable()
export class StaffInvitationsService {
  private readonly logger = new Logger('StaffInvitations')

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender | null,
  ) {}

  /** Super Admin → College Admin invitation. */
  async inviteCollegeAdmin(actor: AuthenticatedAccount, input: { email: string; displayName: string; institutionId: string }) {
    const sender = requireEmailSender(this.email, 'inviting staff')
    const email = normalizeEmail(input.email)
    const displayName = input.displayName.trim().replace(/\s+/g, ' ')
    const institution = await this.prisma.institution.findFirst({ where: { id: input.institutionId, isActive: true }, select: { id: true, name: true } })
    if (!institution) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Choose an active college.', [{ field: 'institutionId', messages: ['Choose an active college.'] }])
    await this.assertEmailAvailable(email)

    const token = generateToken()
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
    const invitation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.staffInvitation.create({
        data: { email, displayName, role: 'COLLEGE_ADMIN', institutionId: institution.id, tokenHash: hashToken(token), expiresAt, invitedById: actor.id },
        select: { id: true, email: true, displayName: true, role: true, createdAt: true, expiresAt: true },
      })
      await this.audit.record({
        actorType: actorTypeFor(actor.role), actorId: actor.id, action: 'COLLEGE_ADMIN_INVITED', entityType: 'StaffInvitation', entityId: created.id,
        metadata: { role: 'COLLEGE_ADMIN', institutionId: institution.id },
      }, tx)
      return created
    })
    await this.sendInvitation(sender, { ...invitation, institutionName: institution.name }, token)
    return invitation
  }

  /** New link for a pending or expired invitation; the previous link stops working. */
  async resend(actor: AuthenticatedAccount, invitationId: string) {
    const sender = requireEmailSender(this.email, 'resending invitations')
    const invitation = await this.prisma.staffInvitation.findFirst({
      where: { id: invitationId, role: 'COLLEGE_ADMIN' },
      select: { id: true, email: true, displayName: true, role: true, acceptedAt: true, revokedAt: true, expiresAt: true, institution: { select: { name: true } } },
    })
    if (!invitation) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Invitation not found.')
    const state = invitationState(invitation)
    if (state === 'accepted' || state === 'revoked') throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', `This invitation was already ${state}.`)
    const token = generateToken()
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
    await this.prisma.$transaction(async (tx) => {
      await tx.staffInvitation.update({ where: { id: invitation.id }, data: { tokenHash: hashToken(token), expiresAt } })
      await this.audit.record({ actorType: actorTypeFor(actor.role), actorId: actor.id, action: 'STAFF_INVITATION_RESENT', entityType: 'StaffInvitation', entityId: invitation.id }, tx)
    })
    await this.sendInvitation(sender, { ...invitation, expiresAt, institutionName: invitation.institution?.name ?? null }, token)
    return { id: invitation.id, expiresAt: expiresAt.toISOString() }
  }

  async revoke(actor: AuthenticatedAccount, invitationId: string) {
    const now = new Date()
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.staffInvitation.updateMany({ where: { id: invitationId, role: 'COLLEGE_ADMIN', acceptedAt: null, revokedAt: null }, data: { revokedAt: now } })
      if (revoked.count !== 1) {
        const exists = await tx.staffInvitation.findFirst({ where: { id: invitationId, role: 'COLLEGE_ADMIN' }, select: { id: true } })
        throw exists
          ? new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'This invitation was already accepted or revoked.')
          : new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Invitation not found.')
      }
      await this.audit.record({ actorType: actorTypeFor(actor.role), actorId: actor.id, action: 'STAFF_INVITATION_REVOKED', entityType: 'StaffInvitation', entityId: invitationId }, tx)
      return { id: invitationId, revokedAt: now.toISOString() }
    })
  }

  /**
   * One-time provisioning of the first Super Admin (CLI only; there is no HTTP route for this).
   * Refuses when any Super Admin account exists, so it cannot be used to mint further privileged accounts.
   */
  async bootstrapSuperAdmin(input: { email: string; displayName: string; replacePending: boolean }) {
    const sender = requireEmailSender(this.email, 'Super Admin provisioning')
    const email = normalizeEmail(input.email)
    const displayName = input.displayName.trim().replace(/\s+/g, ' ')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('--email must be a valid email address.')
    if (displayName.length < 2 || displayName.length > 120) throw new Error('--name must be 2–120 characters.')
    if (await this.prisma.studentAccount.count({ where: { role: 'SUPER_ADMIN' } })) {
      throw new Error('A Super Admin account already exists. This command only provisions the first one.')
    }
    const now = new Date()
    const pending = await this.prisma.staffInvitation.findMany({ where: { role: 'SUPER_ADMIN', acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, select: { id: true } })
    if (pending.length && !input.replacePending) {
      throw new Error('A Super Admin activation link is already pending. Use it, wait for it to expire, or re-run with --replace-pending to cancel it and send a new one.')
    }
    await this.assertEmailAvailable(email, true)

    const token = generateToken()
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS)
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.staffInvitation.updateMany({ where: { role: 'SUPER_ADMIN', acceptedAt: null, revokedAt: null }, data: { revokedAt: now } })
      const created = await tx.staffInvitation.create({
        data: { email, displayName, role: 'SUPER_ADMIN', tokenHash: hashToken(token), expiresAt },
        select: { id: true, email: true, displayName: true, role: true, expiresAt: true },
      })
      await this.audit.record({ actorType: 'SYSTEM', action: 'SUPER_ADMIN_BOOTSTRAP_INVITED', entityType: 'StaffInvitation', entityId: created.id, metadata: { replacedPending: pending.length } }, tx)
      return created
    })
    await this.sendInvitation(sender, { ...invitation, institutionName: null }, token)
    return { email: invitation.email, expiresAt: invitation.expiresAt, delivery: sender.kind }
  }

  /** What the activation page shows before the password is set. Does not consume the token. */
  async inspect(token: string) {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { email: true, displayName: true, role: true, acceptedAt: true, revokedAt: true, expiresAt: true, institution: { select: { name: true } } },
    })
    if (!invitation || invitationState(invitation) !== 'pending') throw invalidToken()
    return {
      email: invitation.email, displayName: invitation.displayName, role: invitation.role,
      collegeName: invitation.institution?.name ?? null, expiresAt: invitation.expiresAt.toISOString(),
      passwordMinLength: STAFF_PASSWORD_MIN[invitation.role as keyof typeof STAFF_PASSWORD_MIN],
    }
  }

  /** Creates the staff account from a valid invitation. The role comes from the invitation record, never the request. */
  async accept(token: string, password: string) {
    const now = new Date()
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, email: true, displayName: true, role: true, institutionId: true, invitedById: true, acceptedAt: true, revokedAt: true, expiresAt: true },
    })
    if (!invitation || invitationState(invitation, now) !== 'pending' || invitation.role === 'STUDENT') throw invalidToken()
    const minLength = STAFF_PASSWORD_MIN[invitation.role]
    if (password.length < minLength) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Some fields are missing or invalid.', [{ field: 'password', messages: [`password must be at least ${minLength} characters`] }])
    }
    const passwordHash = await this.passwords.hash(password)
    const account = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.staffInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } })
      if (claimed.count !== 1) throw invalidToken()
      if (invitation.role === 'SUPER_ADMIN' && await tx.studentAccount.count({ where: { role: 'SUPER_ADMIN' } })) throw invalidToken()
      if (await tx.studentAccount.findUnique({ where: { email: invitation.email }, select: { id: true } })) {
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'An account already uses this email address, so this invitation cannot be activated. Contact the CampusGuide Super Admin.')
      }
      const created = await tx.studentAccount.create({
        data: {
          email: invitation.email, passwordHash, role: invitation.role, displayName: invitation.displayName,
          institutionId: invitation.role === 'COLLEGE_ADMIN' ? invitation.institutionId : null, emailVerifiedAt: now, passwordChangedAt: now,
        },
        select: { id: true, role: true },
      })
      await tx.staffInvitation.update({ where: { id: invitation.id }, data: { acceptedAccountId: created.id } })
      await this.audit.record({
        actorType: actorTypeFor(created.role), actorId: created.id, action: created.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN_ACTIVATED' : 'COLLEGE_ADMIN_ACTIVATED',
        entityType: 'StudentAccount', entityId: created.id, metadata: { invitationId: invitation.id, invitedById: invitation.invitedById },
      }, tx)
      return created
    })
    return { activated: true, role: account.role }
  }

  /** Staff emails must be new: an existing account (of any role) is never upgraded by an invitation. */
  private async assertEmailAvailable(email: string, cli = false) {
    const [account, pending] = await Promise.all([
      this.prisma.studentAccount.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.staffInvitation.findFirst({ where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { role: true } }),
    ])
    if (account) {
      const message = 'An account already uses this email address. Staff access needs a separate, new email address.'
      throw cli ? new Error(message) : new ApiError(HttpStatus.CONFLICT, 'CONFLICT', message)
    }
    if (pending && !(cli && pending.role === 'SUPER_ADMIN')) {
      const message = 'An invitation is already pending for this email address. Resend it instead.'
      throw cli ? new Error(message) : new ApiError(HttpStatus.CONFLICT, 'CONFLICT', message)
    }
  }

  private async sendInvitation(sender: EmailSender, invitation: { email: string; displayName: string; role: AccountRole; expiresAt: Date; institutionName: string | null }, token: string) {
    await deliverEmail(sender, staffInvitationEmail({
      to: invitation.email, displayName: invitation.displayName, role: invitation.role, collegeName: invitation.institutionName,
      origin: this.config.frontendOrigin, token, expiresAt: invitation.expiresAt,
    }), this.logger)
  }
}

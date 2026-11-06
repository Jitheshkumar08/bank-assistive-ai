import { HttpStatus, Injectable } from '@nestjs/common'
import { presentAuditEvents } from '../audit/audit-view.js'
import { AuditService } from '../audit/audit.service.js'
import { actorTypeFor } from '../auth/roles.js'
import { SessionService, type AuthenticatedAccount } from '../auth/session.service.js'
import { ApiError } from '../common/api-error.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { AuditQueryDto } from './staff.dto.js'
import { invitationState } from './staff-invitations.service.js'

/** Super Admin read models and access changes. Only COLLEGE_ADMIN accounts can be managed here. */
@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly sessions: SessionService) {}

  async overview() {
    const now = new Date()
    const [active, suspended, pending, expired, institutions, recent] = await Promise.all([
      this.prisma.studentAccount.count({ where: { role: 'COLLEGE_ADMIN', status: 'ACTIVE' } }),
      this.prisma.studentAccount.count({ where: { role: 'COLLEGE_ADMIN', status: 'DISABLED' } }),
      this.prisma.staffInvitation.count({ where: { role: 'COLLEGE_ADMIN', acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.staffInvitation.count({ where: { role: 'COLLEGE_ADMIN', acceptedAt: null, revokedAt: null, expiresAt: { lte: now } } }),
      this.prisma.institution.findMany({ where: { isActive: true }, select: { id: true, name: true, shortName: true }, orderBy: { name: 'asc' } }),
      this.prisma.auditEvent.findMany({ where: { actorType: { in: ['ADMIN', 'SUPER_ADMIN', 'SYSTEM'] }, action: { notIn: ['LOGIN_SUCCEEDED', 'LOGIN_FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ])
    return {
      collegeAdmins: { total: active + suspended, active, suspended },
      invitations: { pending, expired },
      institutions,
      recentActivity: await presentAuditEvents(this.prisma, recent),
    }
  }

  async listCollegeAdmins() {
    const now = new Date()
    const [accounts, invitations] = await Promise.all([
      this.prisma.studentAccount.findMany({
        where: { role: 'COLLEGE_ADMIN' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, displayName: true, email: true, status: true, createdAt: true,
          institution: { select: { id: true, shortName: true } },
          sessions: { orderBy: { lastUsedAt: 'desc' }, take: 1, select: { lastUsedAt: true } },
        },
      }),
      this.prisma.staffInvitation.findMany({
        where: { role: 'COLLEGE_ADMIN', acceptedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, displayName: true, email: true, createdAt: true, expiresAt: true, revokedAt: true, acceptedAt: true,
          institution: { select: { id: true, shortName: true } }, invitedBy: { select: { displayName: true, email: true } } },
      }),
    ])
    return {
      accounts: accounts.map((account) => ({
        id: account.id, displayName: account.displayName, email: account.email, status: account.status === 'ACTIVE' ? 'active' : 'suspended',
        college: account.institution, createdAt: account.createdAt.toISOString(), lastActiveAt: account.sessions[0]?.lastUsedAt.toISOString() ?? null,
      })),
      invitations: invitations.map((invitation) => ({
        id: invitation.id, displayName: invitation.displayName, email: invitation.email, state: invitationState(invitation, now),
        college: invitation.institution, createdAt: invitation.createdAt.toISOString(), expiresAt: invitation.expiresAt.toISOString(),
        invitedBy: invitation.invitedBy ? (invitation.invitedBy.displayName ?? invitation.invitedBy.email) : 'System',
      })),
    }
  }

  /** Suspends a College Admin: blocks sign-in and ends every session immediately. Reversible with `restore`. */
  async suspend(actor: AuthenticatedAccount, accountId: string, reason?: string) {
    return this.changeAccess(actor, accountId, 'DISABLED', reason)
  }

  async restore(actor: AuthenticatedAccount, accountId: string, reason?: string) {
    return this.changeAccess(actor, accountId, 'ACTIVE', reason)
  }

  private async changeAccess(actor: AuthenticatedAccount, accountId: string, status: 'ACTIVE' | 'DISABLED', reason?: string) {
    if (accountId === actor.id) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You cannot change your own access.')
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.studentAccount.findUnique({ where: { id: accountId }, select: { id: true, role: true, status: true } })
      // Only College Admins are managed here — never students or other Super Admins.
      if (!target || target.role !== 'COLLEGE_ADMIN') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'College Admin account not found.')
      if (target.status === status) throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', status === 'ACTIVE' ? 'This account already has access.' : 'This account is already suspended.')
      await tx.studentAccount.update({ where: { id: accountId }, data: { status } })
      if (status === 'DISABLED') await this.sessions.revokeAll(accountId, tx)
      await this.audit.record({
        actorType: actorTypeFor(actor.role), actorId: actor.id, action: status === 'ACTIVE' ? 'STAFF_ACCESS_RESTORED' : 'STAFF_ACCESS_SUSPENDED',
        entityType: 'StudentAccount', entityId: accountId, ...(reason ? { metadata: { reason } } : {}),
      }, tx)
      return { id: accountId, status: status === 'ACTIVE' ? 'active' : 'suspended' }
    })
  }

  async auditEvents(query: AuditQueryDto) {
    const where: Prisma.AuditEventWhereInput = {
      ...(query.actorType ? { actorType: query.actorType } : {}), ...(query.action ? { action: query.action } : {}), ...(query.entityType ? { entityType: query.entityType } : {}),
    }
    const [total, events] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ])
    return { items: await presentAuditEvents(this.prisma, events), total, page: query.page, pageSize: query.pageSize }
  }
}

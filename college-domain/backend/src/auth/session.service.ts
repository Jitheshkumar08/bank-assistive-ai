import { Injectable } from '@nestjs/common'
import type { CookieOptions } from 'express'
import { AppConfig } from '../config/app-config.service.js'
import type { AccountRole, Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { generateToken, hashToken } from './tokens.js'

/** The signed-in account, resolved from the session cookie on every request (role included — never from the client). */
export type AuthenticatedAccount = {
  id: string
  email: string
  role: AccountRole
  displayName: string | null
  /** College a COLLEGE_ADMIN manages; null otherwise. */
  institutionId: string | null
  sessionId: string
}
/** Kept for the student-facing code, where the account is always a STUDENT. */
export type AuthenticatedStudent = AuthenticatedAccount

const touchIntervalMs = 5 * 60 * 1000

/**
 * Opaque server-side sessions. The browser gets a random token in an HttpOnly cookie; the database stores only its
 * hash, so sessions can be expired, revoked individually (logout) or all at once (password reset).
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfig) {}

  /** `__Host-` prefix (production) pins the cookie to this host, HTTPS and path "/". */
  get cookieName() {
    return this.config.isProduction ? '__Host-cg_session' : 'cg_session'
  }

  cookieOptions(expiresAt?: Date): CookieOptions {
    return { httpOnly: true, secure: this.config.isProduction, sameSite: 'strict', path: '/', ...(expiresAt ? { expires: expiresAt } : {}) }
  }

  async create(studentId: string, rememberMe: boolean, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const token = generateToken()
    const ttlMs = rememberMe ? this.config.env.REMEMBER_ME_DAYS * 86_400_000 : this.config.env.SESSION_TTL_HOURS * 3_600_000
    const expiresAt = new Date(Date.now() + ttlMs)
    await db.studentSession.create({ data: { studentId, tokenHash: hashToken(token), expiresAt } })
    return { token, expiresAt }
  }

  /** Returns the account for a valid session token, or null. Only active, email-verified accounts qualify. */
  async resolve(token: string | undefined): Promise<AuthenticatedAccount | null> {
    if (!token || token.length > 200) return null
    const session = await this.prisma.studentSession.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true,
        student: { select: { id: true, email: true, role: true, displayName: true, institutionId: true, status: true, emailVerifiedAt: true, passwordChangedAt: true } } },
    })
    const now = Date.now()
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null
    const { student } = session
    if (student.status !== 'ACTIVE' || !student.emailVerifiedAt || student.passwordChangedAt > session.createdAt) return null
    if (now - session.lastUsedAt.getTime() > touchIntervalMs) {
      await this.prisma.studentSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } })
    }
    return { id: student.id, email: student.email, role: student.role, displayName: student.displayName, institutionId: student.institutionId, sessionId: session.id }
  }

  async revoke(token: string | undefined) {
    if (!token || token.length > 200) return
    await this.prisma.studentSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } })
  }

  revokeAll(studentId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.studentSession.updateMany({ where: { studentId, revokedAt: null }, data: { revokedAt: new Date() } })
  }
}

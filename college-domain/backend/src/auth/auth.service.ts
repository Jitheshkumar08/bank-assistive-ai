import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { ApiError } from '../common/api-error.js'
import { AppConfig } from '../config/app-config.service.js'
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from '../email/email.types.js'
import { Prisma, type AccountRole, type AccountTokenPurpose } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { alreadyRegisteredEmail, passwordResetEmail, verificationEmail } from './auth.emails.js'
import type { LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto.js'
import { PasswordService } from './password.service.js'
import { actorTypeFor } from './roles.js'
import { SessionService } from './session.service.js'
import { generateToken, hashToken, normalizeEmail } from './tokens.js'

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TTL_MS = 30 * 60 * 1000
const MAX_FAILED_LOGINS = 10
const LOCK_MS = 15 * 60 * 1000

/** Same wording whatever the account state, so responses never reveal whether an email is registered. */
export const GENERIC_REGISTER_MESSAGE = 'If this email can be used, we have sent a message with the next step. Check your inbox.'
export const GENERIC_RESET_MESSAGE = 'If an account exists for this email, we have sent a password reset link. Check your inbox.'

const invalidCredentials = () => new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
const invalidToken = () => new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired. Request a new one.')

/** Public view of the signed-in account (any role). `role` drives the frontend redirect; access is enforced server-side. */
export type PublicStudent = { id: string; email: string; emailVerified: boolean; createdAt: string; role: AccountRole; displayName: string | null }

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth')

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender | null,
  ) {}

  /** Fails before touching the database when no email provider is configured — never pretends to send. */
  private requireEmail(): EmailSender {
    if (!this.email) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'EMAIL_PROVIDER_NOT_CONFIGURED',
        'Email delivery is not set up on this CampusGuide server yet, so this action is unavailable. Please try again later.')
    }
    return this.email
  }

  private async deliver(sender: EmailSender, message: EmailMessage) {
    try {
      await sender.send(message)
    } catch (error) {
      this.logger.error(`Email delivery failed (${sender.kind})`, error instanceof Error ? error.message : undefined)
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'EMAIL_DELIVERY_FAILED', 'We could not send the email right now. Please try again in a few minutes.')
    }
  }

  private issueToken(tx: Prisma.TransactionClient, studentId: string, purpose: AccountTokenPurpose, ttlMs: number) {
    const token = generateToken()
    return tx.accountToken.updateMany({ where: { studentId, purpose, consumedAt: null }, data: { consumedAt: new Date() } })
      .then(() => tx.accountToken.create({ data: { studentId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } }))
      .then(() => token)
  }

  static toPublic(account: { id: string; email: string; emailVerifiedAt: Date | null; createdAt: Date; role: AccountRole; displayName: string | null }): PublicStudent {
    return {
      id: account.id, email: account.email, emailVerified: Boolean(account.emailVerifiedAt), createdAt: account.createdAt.toISOString(),
      role: account.role, displayName: account.displayName,
    }
  }

  async register(input: RegisterDto) {
    const sender = this.requireEmail()
    const email = normalizeEmail(input.email)
    // Hash first on every path so the response time does not depend on whether the email exists.
    const passwordHash = await this.passwords.hash(input.password)
    const existing = await this.prisma.studentAccount.findUnique({ where: { email }, select: { id: true, emailVerifiedAt: true } })
    const origin = this.config.frontendOrigin

    if (existing?.emailVerifiedAt) {
      await this.deliver(sender, alreadyRegisteredEmail(email, origin))
      return { message: GENERIC_REGISTER_MESSAGE }
    }

    let token: string
    try {
      token = await this.prisma.$transaction(async (tx) => {
        // An unverified account is re-registered: the latest password and link replace earlier ones.
        const account = existing
          ? await tx.studentAccount.update({ where: { id: existing.id }, data: { passwordHash, passwordChangedAt: new Date() }, select: { id: true } })
          : await tx.studentAccount.create({ data: { email, passwordHash }, select: { id: true } })
        await this.audit.record({ actorType: 'STUDENT', actorId: account.id, action: existing ? 'REGISTRATION_REPEATED' : 'ACCOUNT_REGISTERED', entityType: 'StudentAccount', entityId: account.id }, tx)
        return this.issueToken(tx, account.id, 'EMAIL_VERIFICATION', VERIFICATION_TTL_MS)
      })
    } catch (error) {
      // A concurrent registration for the same email won the race; answer exactly as for any other request.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { message: GENERIC_REGISTER_MESSAGE }
      throw error
    }
    await this.deliver(sender, verificationEmail(email, origin, token))
    return { message: GENERIC_REGISTER_MESSAGE }
  }

  async resendVerification(rawEmail: string) {
    const sender = this.requireEmail()
    const email = normalizeEmail(rawEmail)
    const account = await this.prisma.studentAccount.findUnique({ where: { email }, select: { id: true, emailVerifiedAt: true, status: true } })
    if (account && !account.emailVerifiedAt && account.status === 'ACTIVE') {
      const token = await this.prisma.$transaction((tx) => this.issueToken(tx, account.id, 'EMAIL_VERIFICATION', VERIFICATION_TTL_MS))
      await this.deliver(sender, verificationEmail(email, this.config.frontendOrigin, token))
    }
    return { message: GENERIC_REGISTER_MESSAGE }
  }

  async verifyEmail(token: string) {
    const now = new Date()
    const record = await this.prisma.accountToken.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, studentId: true, purpose: true, consumedAt: true, expiresAt: true } })
    if (!record || record.purpose !== 'EMAIL_VERIFICATION' || record.consumedAt || record.expiresAt <= now) throw invalidToken()
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.accountToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: now } })
      if (consumed.count !== 1) throw invalidToken()
      await tx.studentAccount.updateMany({ where: { id: record.studentId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } })
      await tx.accountToken.updateMany({ where: { studentId: record.studentId, purpose: 'EMAIL_VERIFICATION', consumedAt: null }, data: { consumedAt: now } })
      await this.audit.record({ actorType: 'STUDENT', actorId: record.studentId, action: 'EMAIL_VERIFIED', entityType: 'StudentAccount', entityId: record.studentId }, tx)
    })
    return { verified: true }
  }

  async login(input: LoginDto) {
    const email = normalizeEmail(input.email)
    const account = await this.prisma.studentAccount.findUnique({ where: { email } })
    if (!account) {
      await this.passwords.verifyAgainstDummy(input.password)
      throw invalidCredentials()
    }
    const now = new Date()
    if (account.lockedUntil && account.lockedUntil > now) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many sign-in attempts. Please wait a few minutes and try again.')
    }
    if (!(await this.passwords.verify(account.passwordHash, input.password))) {
      const attempts = account.failedLoginAttempts + 1
      const lock = attempts >= MAX_FAILED_LOGINS
      await this.prisma.studentAccount.update({ where: { id: account.id }, data: lock ? { failedLoginAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) } : { failedLoginAttempts: attempts } })
      await this.audit.record({ actorType: actorTypeFor(account.role), actorId: account.id, action: lock ? 'ACCOUNT_TEMPORARILY_LOCKED' : 'LOGIN_FAILED', entityType: 'StudentAccount', entityId: account.id })
      throw invalidCredentials()
    }
    // The password is correct from here on, so these specific answers reveal nothing an attacker didn't already prove.
    if (account.status !== 'ACTIVE') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_DISABLED', account.role === 'STUDENT'
        ? 'This account is disabled. Contact the admission office.'
        : 'This staff account is suspended. Contact the CampusGuide Super Admin.')
    }
    if (!account.emailVerifiedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'EMAIL_NOT_VERIFIED', 'Verify your email address before signing in. You can request a new verification link.')

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.studentAccount.update({ where: { id: account.id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
      const created = await this.sessions.create(account.id, input.rememberMe === true, tx)
      await this.audit.record({ actorType: actorTypeFor(account.role), actorId: account.id, action: 'LOGIN_SUCCEEDED', entityType: 'StudentAccount', entityId: account.id, metadata: { rememberMe: input.rememberMe === true } }, tx)
      return created
    })
    return { session, student: AuthService.toPublic(account) }
  }

  async logout(token: string | undefined) {
    await this.sessions.revoke(token)
  }

  async currentStudent(studentId: string) {
    const account = await this.prisma.studentAccount.findUnique({ where: { id: studentId }, select: { id: true, email: true, emailVerifiedAt: true, createdAt: true, role: true, displayName: true } })
    if (!account) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.')
    return { student: AuthService.toPublic(account) }
  }

  async forgotPassword(rawEmail: string) {
    const sender = this.requireEmail()
    const email = normalizeEmail(rawEmail)
    const account = await this.prisma.studentAccount.findUnique({ where: { email }, select: { id: true, emailVerifiedAt: true, status: true, role: true } })
    if (account?.emailVerifiedAt && account.status === 'ACTIVE') {
      const token = await this.prisma.$transaction(async (tx) => {
        const issued = await this.issueToken(tx, account.id, 'PASSWORD_RESET', RESET_TTL_MS)
        await this.audit.record({ actorType: actorTypeFor(account.role), actorId: account.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'StudentAccount', entityId: account.id }, tx)
        return issued
      })
      await this.deliver(sender, passwordResetEmail(email, this.config.frontendOrigin, token))
    }
    return { message: GENERIC_RESET_MESSAGE }
  }

  async resetPassword(input: ResetPasswordDto) {
    const now = new Date()
    const record = await this.prisma.accountToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
      select: { id: true, studentId: true, purpose: true, consumedAt: true, expiresAt: true, student: { select: { role: true } } },
    })
    if (!record || record.purpose !== 'PASSWORD_RESET' || record.consumedAt || record.expiresAt <= now) throw invalidToken()
    const passwordHash = await this.passwords.hash(input.password)
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.accountToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: now } })
      if (consumed.count !== 1) throw invalidToken()
      await tx.studentAccount.update({ where: { id: record.studentId }, data: { passwordHash, passwordChangedAt: now, failedLoginAttempts: 0, lockedUntil: null } })
      await tx.accountToken.updateMany({ where: { studentId: record.studentId, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: now } })
      await this.sessions.revokeAll(record.studentId, tx)
      await this.audit.record({ actorType: actorTypeFor(record.student.role), actorId: record.studentId, action: 'PASSWORD_RESET_COMPLETED', entityType: 'StudentAccount', entityId: record.studentId }, tx)
    })
    return { passwordReset: true }
  }
}

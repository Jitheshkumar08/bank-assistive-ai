import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { AuthenticatedAccount } from '../../src/auth/session.service.js'
import { hashToken } from '../../src/auth/tokens.js'

/**
 * Phase 6 test support: an in-memory stand-in for the few tables the assistant path reads, so the REAL SessionService,
 * SessionGuard, RolesGuard, ContextService, AdmissionService, FeeService, AssistantAdmissionStatusService and
 * AssistantService run without PostgreSQL. SYNTHETIC data only (example.test addresses, invented names and ranks).
 */

export type FakeRecord = {
  id: string; institutionId: string; officialEmail: string | null; studentAccountId: string | null; nucatReference: string
  studentName: string; nucatRank: number | null; admissionStatus: string | null; verifiedAt: Date | null; admissionYear: number
  allocatedBranch: { name: string } | null; feeCategory: null
}

export type FakeAccount = { id: string; email: string; role: 'STUDENT' | 'COLLEGE_ADMIN' | 'SUPER_ADMIN'; institutionId: string | null }

export const record = (over: Partial<FakeRecord>): FakeRecord => ({
  id: 'r', institutionId: 'test-college', officialEmail: null, studentAccountId: null, nucatReference: 'REF',
  studentName: 'Synthetic Student', nucatRank: null, admissionStatus: 'PROVISIONAL', verifiedAt: null, admissionYear: 2026,
  allocatedBranch: null, feeCategory: null, ...over,
})

export const accountFor = (over: Partial<AuthenticatedAccount> = {}): AuthenticatedAccount => ({
  id: 'student-a', email: 'a.student@example.test', role: 'STUDENT', displayName: null, institutionId: null, sessionId: 'session-a', ...over,
})

/** Synthetic students used across the Phase 6 tests. */
export const STUDENT_A: FakeAccount = { id: 'student-a', email: 'a.student@example.test', role: 'STUDENT', institutionId: null }
export const STUDENT_B: FakeAccount = { id: 'student-b', email: 'b.student@example.test', role: 'STUDENT', institutionId: null }
export const STUDENT_C: FakeAccount = { id: 'student-c', email: 'c.student@example.test', role: 'STUDENT', institutionId: null }
export const ADMIN: FakeAccount = { id: 'admin-1', email: 'admin@example.test', role: 'COLLEGE_ADMIN', institutionId: 'test-college' }

export const RECORD_A = record({ id: 'rec-a', officialEmail: 'A.Student@example.test', studentName: 'Synthetic Student A', nucatRank: 145, admissionStatus: 'Seat allotted', allocatedBranch: { name: 'Synthetic Engineering' } })
export const RECORD_B = record({ id: 'rec-b', officialEmail: 'b.student@example.test', studentName: 'Synthetic Student B', nucatRank: 999, nucatReference: 'B-REF', admissionStatus: 'Waitlisted' })
/** Student C's record has no rank and no branch yet (missing optional fields). */
export const RECORD_C = record({ id: 'rec-c', officialEmail: 'c.student@example.test', studentName: 'Synthetic Student C', nucatReference: 'C-REF', admissionStatus: null })
/** A record of the same email at ANOTHER college: must never answer for test-college. */
export const RECORD_A_OTHER_COLLEGE = record({ id: 'rec-a2', institutionId: 'other-college', officialEmail: 'a.student@example.test', studentName: 'Synthetic Student A (other college)', nucatRank: 1 })

export class InMemoryDb {
  readonly queries: unknown[] = []
  readonly sessions = new Map<string, { id: string; expiresAt: Date; revokedAt: Date | null; account: FakeAccount }>()
  /** Active colleges. test-institute-a is the engine's synthetic fixture institution (integration test). */
  institutions = ['test-college', 'other-college', 'test-institute-a']
  /** Accounts that can sign in through the REAL POST /api/auth/login (argon2 hash supplied by the test). */
  readonly accounts = new Map<string, FakeAccount & { passwordHash: string; emailVerifiedAt: Date | null }>()
  failRecordQuery: Error | null = null
  recordQueryDelayMs = 0

  constructor(public records: FakeRecord[] = [RECORD_A, RECORD_B, RECORD_C, RECORD_A_OTHER_COLLEGE]) {}

  /** A session cookie token for `account`; `expired` / `revoked` produce sessions the real SessionService refuses. */
  /** Ends one session in place (as logout or expiry would), found by its id. */
  endSession(sessionId: string, how: 'revoke' | 'expire' | 'delete' = 'revoke') {
    for (const [hash, session] of this.sessions) {
      if (session.id !== sessionId) continue
      if (how === 'delete') this.sessions.delete(hash)
      else if (how === 'revoke') session.revokedAt = new Date()
      else session.expiresAt = new Date(Date.now() - 1000)
    }
  }

  registerAccount(account: FakeAccount, passwordHash: string, verified = true) {
    this.accounts.set(account.email, { ...account, passwordHash, emailVerifiedAt: verified ? new Date() : null })
  }

  signIn(account: FakeAccount, options: { expired?: boolean; revoked?: boolean } = {}) {
    const token = `tok-${account.id}-${this.sessions.size}-${Math.random().toString(36).slice(2)}`
    this.sessions.set(hashToken(token), {
      id: `session-${account.id}-${this.sessions.size}`,
      expiresAt: new Date(Date.now() + (options.expired ? -1000 : 3_600_000)),
      revokedAt: options.revoked ? new Date() : null,
      account,
    })
    return token
  }

  /** The PrismaService stand-in: only the calls the assistant path makes. */
  prisma() {
    const now = new Date()
    const client = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(client),
      studentAccount: {
        findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
          const found = where.email ? this.accounts.get(where.email) : [...this.accounts.values()].find((a) => a.id === where.id)
          return found ? { ...found, displayName: null, status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null, passwordChangedAt: new Date(0), createdAt: new Date(0) } : null
        },
        update: async () => ({}),
      },
      studentSession: {
        create: async ({ data }: { data: { studentId: string; tokenHash: string; expiresAt: Date } }) => {
          const account = [...this.accounts.values()].find((a) => a.id === data.studentId)!
          const id = `session-${account.id}-${this.sessions.size}`
          this.sessions.set(data.tokenHash, { id, expiresAt: data.expiresAt, revokedAt: null, account })
          return { id }
        },
        findUnique: async ({ where }: { where: { tokenHash: string } }) => {
          const session = this.sessions.get(where.tokenHash)
          if (!session) return null
          return {
            id: session.id, expiresAt: session.expiresAt, revokedAt: session.revokedAt, lastUsedAt: now, createdAt: new Date(now.getTime() - 1000),
            student: { ...session.account, displayName: null, status: 'ACTIVE', emailVerifiedAt: now, passwordChangedAt: new Date(0) },
          }
        },
        update: async () => ({}),
        /** SessionService.revoke (logout): by token hash, only sessions not yet revoked. */
        updateMany: async ({ where }: { where: { tokenHash?: string; studentId?: string } }) => {
          let count = 0
          for (const [hash, session] of this.sessions) {
            const match = where.tokenHash ? hash === where.tokenHash : session.account.id === where.studentId
            if (match && !session.revokedAt) { session.revokedAt = new Date(); count += 1 }
          }
          return { count }
        },
        /** AssistantService.sweepEndedSessions: sessions by id. */
        findMany: async ({ where }: { where: { id: { in: string[] } } }) => [...this.sessions.values()]
          .filter((session) => where.id.in.includes(session.id))
          .map(({ id, revokedAt, expiresAt }) => ({ id, revokedAt, expiresAt })),
      },
      institution: {
        findFirst: async ({ where }: { where: { id: string } }) => (this.institutions.includes(where.id)
          ? { id: where.id, name: 'Synthetic College', shortName: 'SC' } : null),
      },
      institutionQrCode: {
        findFirst: async ({ where }: { where: { areaSlug: string } }) => (where.areaSlug === 'admissions-desk' ? { id: 'qr' } : null),
      },
      admissionRecord: {
        findMany: async (args: { where: { institutionId: string; officialEmail: { equals: string }; OR: { studentAccountId: string | null }[] } }) => {
          this.queries.push(args.where)
          if (this.recordQueryDelayMs) await new Promise((resolve) => setTimeout(resolve, this.recordQueryDelayMs))
          if (this.failRecordQuery) throw this.failRecordQuery
          const { institutionId, officialEmail, OR } = args.where
          return this.records
            .filter((r) => r.institutionId === institutionId && r.officialEmail?.toLowerCase() === officialEmail.equals.toLowerCase()
              && OR.some((clause) => clause.studentAccountId === r.studentAccountId))
            .sort((x, y) => y.admissionYear - x.admissionYear)
        },
      },
      feeSchedule: { findMany: async () => [] },
      auditEvent: { create: async () => ({}) },
    }
    return client
  }
}

/** Environment for the real AppConfig (no database is ever contacted: PrismaService is replaced). */
export function assistantTestEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused_test',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    ...extra,
  })
}

/**
 * The real HTTP pipeline (configureApp: validation pipe, cookies, origin check, error filter) with the real
 * AssistantModule, over the in-memory database. `engine` replaces the engine client when given (unit level); without
 * it the real HttpCollegeEngineClient talks to AI_ENGINE_URL (integration level).
 */
export async function createAssistantApp(db: InMemoryDb, engine?: unknown) {
  const { AppConfigModule } = await import('../../src/config/config.module.js')
  const { PrismaModule } = await import('../../src/prisma/prisma.module.js')
  const { PrismaService } = await import('../../src/prisma/prisma.service.js')
  const { AuditModule } = await import('../../src/audit/audit.module.js')
  const { EmailModule } = await import('../../src/email/email.module.js')
  const { AssistantModule } = await import('../../src/assistant/assistant.module.js')
  const { CollegeEngineClient } = await import('../../src/assistant/engine/college-engine.client.js')
  const { AllExceptionsFilter } = await import('../../src/common/all-exceptions.filter.js')
  const { RateLimitGuard } = await import('../../src/common/rate-limit.js')
  const { configureApp } = await import('../../src/configure-app.js')

  const builder = Test.createTestingModule({
    imports: [AppConfigModule, PrismaModule, AuditModule, EmailModule, AssistantModule],
    providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
  })
  builder.overrideProvider(PrismaService).useValue(db.prisma())
  if (engine) builder.overrideProvider(CollegeEngineClient).useValue(engine)
  const moduleRef = await builder.compile()
  const app: INestApplication = moduleRef.createNestApplication({ bodyParser: false, logger: false })
  configureApp(app)
  await app.init()
  return { app, api: () => request(app.getHttpServer()) }
}

export const cookie = (token: string) => `cg_session=${token}`

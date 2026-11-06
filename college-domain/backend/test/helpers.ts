import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { EmailMessage, EmailSender } from '../src/email/email.types.js'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { loadTestDatabaseUrl } from './test-database.js'

export class CapturingEmailSender implements EmailSender {
  readonly kind = 'memory' as const
  readonly sent: EmailMessage[] = []
  fail = false
  async send(message: EmailMessage) {
    if (this.fail) throw new Error('SMTP unavailable (simulated)')
    this.sent.push(message)
  }
  /** The single-use token from the most recent message to `to`. */
  lastToken(to: string) {
    const message = [...this.sent].reverse().find((item) => item.to === to)
    const token = message?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1]
    if (!token) throw new Error(`no token emailed to ${to}`)
    return token
  }
}

/**
 * Builds the real application (configureApp + AppModule) against the test database.
 * Env overrides must be decided before the first import in a test file, so each file uses one configuration.
 */
export async function createTestApp(options: { email?: EmailSender | null; env?: Record<string, string> } = {}) {
  const { url } = loadTestDatabaseUrl()
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url, RATE_LIMIT_AUTH: '1000', RATE_LIMIT_EMAIL: '1000', RATE_LIMIT_IMPORT: '1000', ...options.env })
  const { AppModule } = await import('../src/app.module.js')
  const { configureApp } = await import('../src/configure-app.js')
  const { EMAIL_SENDER } = await import('../src/email/email.types.js')
  const { PrismaService } = await import('../src/prisma/prisma.service.js')

  const builder = Test.createTestingModule({ imports: [AppModule] })
  builder.overrideProvider(EMAIL_SENDER).useValue(options.email === undefined ? new CapturingEmailSender() : options.email)
  const moduleRef = await builder.compile()
  const app: INestApplication = moduleRef.createNestApplication({ bodyParser: false, logger: false })
  configureApp(app)
  await app.init()
  const prisma = app.get(PrismaService)
  return { app, prisma, api: () => request(app.getHttpServer()) }
}

/** Empties every table in the TEST database and restores institution context. Refuses to run anywhere else. */
export async function resetTestDatabase(prisma: PrismaService) {
  const [{ name }] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${name}"`)
  await prisma.$executeRawUnsafe('TRUNCATE "AuditEvent", "FeeSchedule", "AdmissionImportRow", "AdmissionRecord", "AdmissionImportBatch", "StaffInvitation", "Branch", "InstitutionQrCode", "Institution", "AccountToken", "StudentSession", "StudentAccount" CASCADE')
  await prisma.institution.create({ data: { id: 'nmamit', name: 'NMAM Institute of Technology', shortName: 'NMAMIT', parentName: 'Nitte (Deemed to be University)' } })
  await prisma.institutionQrCode.create({ data: { institutionId: 'nmamit', areaSlug: 'admissions-desk', label: 'Admission desk' } })
}

/** Fails if any secret-bearing field appears anywhere in a response body. */
export function expectNoSecrets(body: unknown) {
  const text = JSON.stringify(body ?? null)
  for (const forbidden of ['passwordHash', 'tokenHash', '$argon2', 'token"', 'failedLoginAttempts', 'lockedUntil']) {
    expect(text).not.toContain(forbidden)
  }
}

/** Synthetic staff accounts created through the real provisioning flows (bootstrap → activation → login). */
export const SUPER_ADMIN = { email: 'root.fixture@example.com', name: 'Fixture Super Admin', password: 'fixture super admin passphrase' }
export const COLLEGE_ADMIN = { email: 'staff.fixture@example.com', name: 'Fixture College Admin', password: 'fixture admin passphrase' }

export async function provisionStaff(app: INestApplication, api: () => request.Agent | ReturnType<typeof request>, mail: CapturingEmailSender, college = COLLEGE_ADMIN, institutionId = 'nmamit') {
  const { StaffInvitationsService } = await import('../src/staff/staff-invitations.service.js')
  const http = api as () => ReturnType<typeof request>
  let superAdmin = await loginCookie(http, SUPER_ADMIN)
  if (!superAdmin) {
    await app.get(StaffInvitationsService).bootstrapSuperAdmin({ email: SUPER_ADMIN.email, displayName: SUPER_ADMIN.name, replacePending: false })
    await http().post('/api/auth/invitations/accept').send({ token: mail.lastToken(SUPER_ADMIN.email), password: SUPER_ADMIN.password }).expect(200)
    superAdmin = (await loginCookie(http, SUPER_ADMIN))!
  }
  await http().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin)
    .send({ email: college.email, displayName: college.name, institutionId }).expect(201)
  await http().post('/api/auth/invitations/accept').send({ token: mail.lastToken(college.email), password: college.password }).expect(200)
  const collegeAdmin = (await loginCookie(http, college))!
  return { superAdmin, collegeAdmin }
}

async function loginCookie(http: () => ReturnType<typeof request>, user: { email: string; password: string }) {
  const response = await http().post('/api/auth/login').send({ email: user.email, password: user.password })
  return response.status === 200 ? sessionCookie(response)!.split(';')[0] : null
}

export const sessionCookie = (response: { headers: Record<string, unknown> }) => {
  const cookies = ([] as string[]).concat((response.headers['set-cookie'] as string[] | string | undefined) ?? [])
  return cookies.find((cookie) => cookie.startsWith('cg_session='))
}

import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { StaffInvitationsService } from '../src/staff/staff-invitations.service.js'
import { CapturingEmailSender, COLLEGE_ADMIN, createTestApp, expectNoSecrets, provisionStaff, resetTestDatabase, sessionCookie, SUPER_ADMIN } from './helpers.js'

// Synthetic TEST-ONLY accounts in the disposable test database.
const STUDENT = { email: 'student.fixture@example.com', password: 'fixture student passphrase' }

describe('Roles, staff provisioning and Super Admin management (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let api: Awaited<ReturnType<typeof createTestApp>>['api']
  const mail = new CapturingEmailSender()

  beforeAll(async () => { ({ app, prisma, api } = await createTestApp({ email: mail })) })
  afterAll(async () => { await app?.close() })
  beforeEach(async () => { mail.sent.length = 0; mail.fail = false; await resetTestDatabase(prisma) })

  async function studentCookie() {
    await api().post('/api/auth/register').send(STUDENT).expect(202)
    await api().post('/api/auth/verify-email').send({ token: mail.lastToken(STUDENT.email) }).expect(200)
    return sessionCookie(await api().post('/api/auth/login').send(STUDENT).expect(200))!.split(';')[0]
  }

  describe('common login and roles', () => {
    it('returns each account’s role from the database at login', async () => {
      const { superAdmin, collegeAdmin } = await provisionStaff(app, api, mail)
      const student = await studentCookie()
      expect((await api().get('/api/auth/me').set('Cookie', student).expect(200)).body.student).toMatchObject({ role: 'STUDENT', displayName: null })
      expect((await api().get('/api/auth/me').set('Cookie', collegeAdmin).expect(200)).body.student).toMatchObject({ role: 'COLLEGE_ADMIN', displayName: COLLEGE_ADMIN.name, email: COLLEGE_ADMIN.email })
      expect((await api().get('/api/auth/me').set('Cookie', superAdmin).expect(200)).body.student).toMatchObject({ role: 'SUPER_ADMIN', displayName: SUPER_ADMIN.name })
      const login = await api().post('/api/auth/login').send({ email: COLLEGE_ADMIN.email, password: COLLEGE_ADMIN.password }).expect(200)
      expect(login.body.student.role).toBe('COLLEGE_ADMIN')
      expectNoSecrets(login.body)
    })

    it('public registration always creates a STUDENT and refuses a role field', async () => {
      const attempt = await api().post('/api/auth/register').send({ ...STUDENT, role: 'SUPER_ADMIN' }).expect(400)
      expect(attempt.body.code).toBe('VALIDATION_FAILED')
      expect(await prisma.studentAccount.count()).toBe(0)
      // Even an "admin-looking" email domain gets no privileges.
      await api().post('/api/auth/register').send({ email: 'principal@nmamit.in', password: 'fixture student passphrase' }).expect(202)
      expect(await prisma.studentAccount.findUnique({ where: { email: 'principal@nmamit.in' }, select: { role: true } })).toEqual({ role: 'STUDENT' })
    })

    it.each([
      ['GET', '/api/admin/dashboard'], ['GET', '/api/admin/student-records'], ['GET', '/api/admin/admission-imports'],
      ['GET', '/api/super-admin/overview'], ['GET', '/api/super-admin/college-admins'], ['GET', '/api/super-admin/audit-events'],
    ])('%s %s needs a session (401) and the right role (403 for a student)', async (_method, path) => {
      expect((await api().get(path).expect(401)).body.code).toBe('UNAUTHENTICATED')
      const cookie = await studentCookie()
      expect((await api().get(path).set('Cookie', cookie).expect(403)).body.code).toBe('FORBIDDEN')
    })

    it('keeps College Admins out of Super Admin routes, and both staff roles out of student routes', async () => {
      const { superAdmin, collegeAdmin } = await provisionStaff(app, api, mail)
      await api().get('/api/super-admin/overview').set('Cookie', collegeAdmin).expect(403)
      const escalate = await api().post('/api/super-admin/college-admins/invitations').set('Cookie', collegeAdmin).send({ email: 'x@example.com', displayName: 'X', institutionId: 'nmamit' }).expect(403)
      expect(escalate.body.code).toBe('FORBIDDEN')
      await api().get('/api/admin/dashboard').set('Cookie', superAdmin).expect(403)
      await api().get('/api/students/me/admission-result?collegeId=nmamit').set('Cookie', collegeAdmin).expect(403)
      await api().get('/api/students/me/admission-result?collegeId=nmamit').set('Cookie', superAdmin).expect(403)
      expect(await prisma.staffInvitation.count({ where: { email: 'x@example.com' } })).toBe(0)
    })
  })

  describe('Super Admin bootstrap (CLI service)', () => {
    it('provisions exactly one Super Admin through an emailed single-use link', async () => {
      const service = app.get(StaffInvitationsService)
      const result = await service.bootstrapSuperAdmin({ email: SUPER_ADMIN.email, displayName: SUPER_ADMIN.name, replacePending: false })
      expect(result.email).toBe(SUPER_ADMIN.email)
      expect(JSON.stringify(result)).not.toMatch(/token/i)
      // A second run while the link is pending is refused unless explicitly replacing it.
      await expect(service.bootstrapSuperAdmin({ email: 'other.root@example.com', displayName: 'Other', replacePending: false })).rejects.toThrow(/already pending/)
      const token = mail.lastToken(SUPER_ADMIN.email)
      const info = await api().post('/api/auth/invitations/inspect').send({ token }).expect(200)
      expect(info.body).toMatchObject({ email: SUPER_ADMIN.email, role: 'SUPER_ADMIN', passwordMinLength: 16 })
      // Super Admin passwords need 16+ characters.
      expect((await api().post('/api/auth/invitations/accept').send({ token, password: 'only 14 chars!' }).expect(400)).body.details[0].field).toBe('password')
      await api().post('/api/auth/invitations/accept').send({ token, password: SUPER_ADMIN.password }).expect(200)
      // Single use.
      expect((await api().post('/api/auth/invitations/accept').send({ token, password: SUPER_ADMIN.password }).expect(400)).body.code).toBe('INVALID_OR_EXPIRED_TOKEN')
      // Once a Super Admin exists the command refuses to create another one.
      await expect(service.bootstrapSuperAdmin({ email: 'other.root@example.com', displayName: 'Other', replacePending: true })).rejects.toThrow(/already exists/)
      expect(await prisma.studentAccount.count({ where: { role: 'SUPER_ADMIN' } })).toBe(1)
      expect(await prisma.auditEvent.count({ where: { action: { in: ['SUPER_ADMIN_BOOTSTRAP_INVITED', 'SUPER_ADMIN_ACTIVATED'] } } })).toBe(2)
    })

    it('has no HTTP route that grants Super Admin rights', async () => {
      for (const path of ['/api/super-admin/bootstrap', '/api/super-admin/super-admins', '/api/auth/register-admin']) {
        expect((await api().post(path).send({ email: 'x@example.com' })).status).toBe(404)
      }
    })
  })

  describe('College Admin invitations', () => {
    it('invites, activates and lets the new admin sign in; the role comes from the invitation', async () => {
      const { superAdmin } = await provisionStaff(app, api, mail)
      const invite = await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin)
        .send({ email: 'New.Staff@Example.com ', displayName: '  New   Staff ', institutionId: 'nmamit' }).expect(201)
      expect(invite.body).toMatchObject({ email: 'new.staff@example.com', displayName: 'New Staff', role: 'COLLEGE_ADMIN' })
      expectNoSecrets(invite.body)
      const token = mail.lastToken('new.staff@example.com')
      // A role in the activation request is rejected, not honoured.
      await api().post('/api/auth/invitations/accept').send({ token, password: 'new staff passphrase', role: 'SUPER_ADMIN' }).expect(400)
      const accepted = await api().post('/api/auth/invitations/accept').send({ token, password: 'new staff passphrase' }).expect(200)
      expect(accepted.body).toEqual({ activated: true, role: 'COLLEGE_ADMIN' })
      const account = await prisma.studentAccount.findUnique({ where: { email: 'new.staff@example.com' }, select: { role: true, institutionId: true, emailVerifiedAt: true } })
      expect(account).toMatchObject({ role: 'COLLEGE_ADMIN', institutionId: 'nmamit' })
      expect(account!.emailVerifiedAt).not.toBeNull()
      await api().post('/api/auth/login').send({ email: 'new.staff@example.com', password: 'new staff passphrase' }).expect(200)
    })

    it('refuses emails that already have an account or a pending invitation', async () => {
      const { superAdmin } = await provisionStaff(app, api, mail)
      await studentCookie()
      const student = await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin).send({ email: STUDENT.email, displayName: 'Student', institutionId: 'nmamit' }).expect(409)
      expect(student.body.code).toBe('CONFLICT')
      expect(await prisma.studentAccount.findUnique({ where: { email: STUDENT.email }, select: { role: true } })).toEqual({ role: 'STUDENT' })
      await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin).send({ email: 'p@example.com', displayName: 'P', institutionId: 'nmamit' }).expect(400)
      await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin).send({ email: 'p@example.com', displayName: 'Pat', institutionId: 'nmamit' }).expect(201)
      await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin).send({ email: 'p@example.com', displayName: 'Pat', institutionId: 'nmamit' }).expect(409)
      await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin).send({ email: 'q@example.com', displayName: 'Quinn', institutionId: 'unknown-college' }).expect(400)
    })

    it('resends (old link dies), revokes, and rejects expired links', async () => {
      const { superAdmin } = await provisionStaff(app, api, mail)
      const invite = await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin).send({ email: 'r@example.com', displayName: 'Robin', institutionId: 'nmamit' }).expect(201)
      const first = mail.lastToken('r@example.com')
      await api().post(`/api/super-admin/college-admins/invitations/${invite.body.id}/resend`).set('Cookie', superAdmin).expect(200)
      const second = mail.lastToken('r@example.com')
      expect(second).not.toBe(first)
      await api().post('/api/auth/invitations/inspect').send({ token: first }).expect(400)
      await prisma.staffInvitation.update({ where: { id: invite.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
      expect((await api().post('/api/auth/invitations/accept').send({ token: second, password: 'robin passphrase 1' }).expect(400)).body.code).toBe('INVALID_OR_EXPIRED_TOKEN')
      await api().post(`/api/super-admin/college-admins/invitations/${invite.body.id}/revoke`).set('Cookie', superAdmin).expect(200)
      await api().post(`/api/super-admin/college-admins/invitations/${invite.body.id}/revoke`).set('Cookie', superAdmin).expect(409)
      const list = await api().get('/api/super-admin/college-admins').set('Cookie', superAdmin).expect(200)
      expect(list.body.invitations.find((item: { id: string }) => item.id === invite.body.id).state).toBe('revoked')
    })

    it('reports a missing email provider honestly instead of creating an invitation', async () => {
      const { superAdmin } = await provisionStaff(app, api, mail)
      mail.fail = true
      const response = await api().post('/api/super-admin/college-admins/invitations').set('Cookie', superAdmin).send({ email: 's@example.com', displayName: 'Sam', institutionId: 'nmamit' }).expect(503)
      expect(response.body.code).toBe('EMAIL_DELIVERY_FAILED')
    })
  })

  describe('suspending and restoring College Admin access', () => {
    it('suspends (ends sessions, blocks login), restores, and audits both', async () => {
      const { superAdmin, collegeAdmin } = await provisionStaff(app, api, mail)
      const { accounts } = (await api().get('/api/super-admin/college-admins').set('Cookie', superAdmin).expect(200)).body
      const target = accounts.find((account: { email: string }) => account.email === COLLEGE_ADMIN.email)
      await api().post(`/api/super-admin/college-admins/${target.id}/suspend`).set('Cookie', superAdmin).send({ reason: 'Left the admission office' }).expect(200)
      await api().get('/api/admin/dashboard').set('Cookie', collegeAdmin).expect(401)
      expect((await api().post('/api/auth/login').send({ email: COLLEGE_ADMIN.email, password: COLLEGE_ADMIN.password }).expect(403)).body.code).toBe('ACCOUNT_DISABLED')
      await api().post(`/api/super-admin/college-admins/${target.id}/suspend`).set('Cookie', superAdmin).send({}).expect(409)
      await api().post(`/api/super-admin/college-admins/${target.id}/restore`).set('Cookie', superAdmin).send({}).expect(200)
      await api().post('/api/auth/login').send({ email: COLLEGE_ADMIN.email, password: COLLEGE_ADMIN.password }).expect(200)
      const audit = await api().get('/api/super-admin/audit-events?pageSize=50').set('Cookie', superAdmin).expect(200)
      const actions = audit.body.items.map((item: { action: string }) => item.action)
      expect(actions).toEqual(expect.arrayContaining(['STAFF_ACCESS_SUSPENDED', 'STAFF_ACCESS_RESTORED', 'COLLEGE_ADMIN_INVITED', 'COLLEGE_ADMIN_ACTIVATED']))
      expect(audit.body.items.find((item: { action: string }) => item.action === 'STAFF_ACCESS_SUSPENDED')).toMatchObject({ actorName: SUPER_ADMIN.name, metadata: { reason: 'Left the admission office' } })
      expectNoSecrets(audit.body)
      expect(JSON.stringify(audit.body)).not.toMatch(/#token=|passphrase/)
    })

    it('cannot target the Super Admin, a student, or yourself', async () => {
      const { superAdmin } = await provisionStaff(app, api, mail)
      await studentCookie()
      const root = await prisma.studentAccount.findUniqueOrThrow({ where: { email: SUPER_ADMIN.email } })
      const student = await prisma.studentAccount.findUniqueOrThrow({ where: { email: STUDENT.email } })
      await api().post(`/api/super-admin/college-admins/${root.id}/suspend`).set('Cookie', superAdmin).send({}).expect(403)
      await api().post(`/api/super-admin/college-admins/${student.id}/suspend`).set('Cookie', superAdmin).send({}).expect(404)
    })

    it('keeps the audit log append-only at the database level', async () => {
      await provisionStaff(app, api, mail)
      const event = await prisma.auditEvent.findFirstOrThrow()
      await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'TAMPERED' } })).rejects.toThrow(/append-only/)
      await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/)
    })
  })
})

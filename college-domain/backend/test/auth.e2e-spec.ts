import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { CapturingEmailSender, createTestApp, expectNoSecrets, resetTestDatabase, sessionCookie } from './helpers.js'

const EMAIL = 'student.one@example.com'
const PASSWORD = 'a long and memorable passphrase'

describe('Auth (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let api: Awaited<ReturnType<typeof createTestApp>>['api']
  const mail = new CapturingEmailSender()

  beforeAll(async () => { ({ app, prisma, api } = await createTestApp({ email: mail })) })
  afterAll(async () => { await app?.close() })
  beforeEach(async () => { mail.sent.length = 0; mail.fail = false; await resetTestDatabase(prisma) })

  async function registerAndVerify(email = EMAIL, password = PASSWORD) {
    await api().post('/api/auth/register').send({ email, password }).expect(202)
    await api().post('/api/auth/verify-email').send({ token: mail.lastToken(email) }).expect(200)
  }
  const login = (email = EMAIL, password = PASSWORD, extra: Record<string, unknown> = {}) =>
    api().post('/api/auth/login').send({ email, password, ...extra })

  it('GET /api/health reports the database', async () => {
    const response = await api().get('/api/health').expect(200)
    expect(response.body).toEqual({ status: 'ok', database: 'ok' })
    expect(response.headers['x-request-id']).toBeDefined()
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  describe('registration', () => {
    it('creates an unverified account with an Argon2id hash and emails a verification link', async () => {
      const response = await api().post('/api/auth/register').send({ email: '  Student.One@Example.com ', password: PASSWORD }).expect(202)
      expect(response.body).toEqual({ message: expect.stringContaining('If this email can be used') })
      expectNoSecrets(response.body)
      const account = await prisma.studentAccount.findUniqueOrThrow({ where: { email: EMAIL } })
      expect(account.emailVerifiedAt).toBeNull()
      expect(account.passwordHash).toMatch(/^\$argon2id\$/)
      expect(account.passwordHash).not.toContain(PASSWORD)
      expect(mail.sent).toHaveLength(1)
      expect(mail.sent[0].text).toMatch(/http:\/\/localhost:5173\/verify-email#token=[A-Za-z0-9_-]{43}/)
      const tokens = await prisma.accountToken.findMany({ where: { studentId: account.id } })
      expect(tokens).toHaveLength(1)
      expect(tokens[0].tokenHash).not.toBe(mail.lastToken(EMAIL))
    })

    it('answers identically for new, unverified and verified emails (no account enumeration)', async () => {
      const first = await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      const again = await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      await api().post('/api/auth/verify-email').send({ token: mail.lastToken(EMAIL) }).expect(200)
      const verified = await api().post('/api/auth/register').send({ email: EMAIL, password: 'someone else trying this' }).expect(202)
      expect(again.body).toEqual(first.body)
      expect(verified.body).toEqual(first.body)
      expect(mail.sent.at(-1)!.subject).toBe('CampusGuide sign-up attempt')
      expect(await prisma.studentAccount.count()).toBe(1)
      await login(EMAIL, PASSWORD).expect(200)
    })

    it('re-registering an unverified email invalidates the previous link', async () => {
      await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      const firstToken = mail.lastToken(EMAIL)
      await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      await api().post('/api/auth/verify-email').send({ token: firstToken }).expect(400)
      await api().post('/api/auth/verify-email').send({ token: mail.lastToken(EMAIL) }).expect(200)
    })

    it.each([
      [{ email: 'not-an-email', password: PASSWORD }, 'email'],
      [{ email: EMAIL, password: 'short' }, 'password'],
      [{ email: EMAIL }, 'password'],
      [{ email: EMAIL, password: PASSWORD, studentId: 'someone-else' }, 'studentId'],
    ])('rejects invalid input %j with field details', async (body, field) => {
      const response = await api().post('/api/auth/register').send(body).expect(400)
      expect(response.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' })
      expect(response.body.details.map((detail: { field: string }) => detail.field)).toContain(field)
      expect(await prisma.studentAccount.count()).toBe(0)
    })

    it('reports an email delivery failure honestly instead of claiming success', async () => {
      mail.fail = true
      const response = await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(503)
      expect(response.body.code).toBe('EMAIL_DELIVERY_FAILED')
    })

    it('rejects malformed JSON with the standard error shape', async () => {
      const response = await api().post('/api/auth/register').set('Content-Type', 'application/json').send('{"email":').expect(400)
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', message: 'The request body is not valid JSON.' })
    })
  })

  describe('email verification', () => {
    it('blocks login until the email is verified, then allows it', async () => {
      await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      const blocked = await login().expect(403)
      expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED')
      expect(sessionCookie(blocked)).toBeUndefined()
      await api().post('/api/auth/verify-email').send({ token: mail.lastToken(EMAIL) }).expect(200, { verified: true })
      await login().expect(200)
    })

    it('tokens are single-use and unknown tokens are rejected', async () => {
      await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      const token = mail.lastToken(EMAIL)
      await api().post('/api/auth/verify-email').send({ token }).expect(200)
      const reused = await api().post('/api/auth/verify-email').send({ token }).expect(400)
      expect(reused.body.code).toBe('INVALID_OR_EXPIRED_TOKEN')
      await api().post('/api/auth/verify-email').send({ token: 'A'.repeat(43) }).expect(400)
      const malformed = await api().post('/api/auth/verify-email').send({ token: 'short' }).expect(400)
      expect(malformed.body.code).toBe('VALIDATION_FAILED')
    })

    it('expired tokens are rejected', async () => {
      await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      await prisma.accountToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
      await api().post('/api/auth/verify-email').send({ token: mail.lastToken(EMAIL) }).expect(400)
    })

    it('resend-verification sends a new link only to unverified accounts, with a generic answer', async () => {
      const unknown = await api().post('/api/auth/resend-verification').send({ email: 'nobody@example.com' }).expect(202)
      expect(mail.sent).toHaveLength(0)
      await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      const known = await api().post('/api/auth/resend-verification').send({ email: EMAIL }).expect(202)
      expect(known.body).toEqual(unknown.body)
      expect(mail.sent).toHaveLength(2)
    })
  })

  describe('login, session and logout', () => {
    it('sets a secure session cookie, returns only public fields and protects /me', async () => {
      await registerAndVerify()
      await api().get('/api/auth/me').expect(401)
      const response = await login().expect(200)
      expectNoSecrets(response.body)
      expect(response.body.student).toEqual({ id: expect.any(String), email: EMAIL, emailVerified: true, createdAt: expect.any(String), role: 'STUDENT', displayName: null })
      const cookie = sessionCookie(response)!
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite=Strict/i)
      expect(cookie).toMatch(/Path=\//)
      const me = await api().get('/api/auth/me').set('Cookie', cookie.split(';')[0]).expect(200)
      expect(me.body.student.email).toBe(EMAIL)
      expectNoSecrets(me.body)
      const stored = await prisma.studentSession.findFirstOrThrow()
      expect(stored.tokenHash).not.toBe(cookie.split(';')[0].split('=')[1])
    })

    it('gives the same answer for an unknown email and a wrong password', async () => {
      await registerAndVerify()
      const wrong = await login(EMAIL, 'definitely the wrong password').expect(401)
      const unknown = await login('nobody@example.com', PASSWORD).expect(401)
      const strip = ({ requestId: _id, ...rest }: Record<string, unknown>) => rest
      expect(strip(wrong.body)).toEqual(strip(unknown.body))
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS')
    })

    it('logout revokes the session server-side and clears the cookie', async () => {
      await registerAndVerify()
      const cookie = sessionCookie(await login().expect(200))!.split(';')[0]
      const out = await api().post('/api/auth/logout').set('Cookie', cookie).expect(204)
      expect(sessionCookie(out)).toMatch(/cg_session=;/)
      await api().get('/api/auth/me').set('Cookie', cookie).expect(401)
      await api().post('/api/auth/logout').expect(204)
    })

    it('rejects expired sessions and remember-me lasts longer', async () => {
      await registerAndVerify()
      const short = await login().expect(200)
      const long = await login(EMAIL, PASSWORD, { rememberMe: true }).expect(200)
      expect(Date.parse(long.body.expiresAt)).toBeGreaterThan(Date.parse(short.body.expiresAt) + 24 * 3_600_000)
      await prisma.studentSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
      await api().get('/api/auth/me').set('Cookie', sessionCookie(short)!.split(';')[0]).expect(401)
    })

    it('temporarily locks an account after 10 wrong passwords', async () => {
      await registerAndVerify()
      for (let attempt = 0; attempt < 10; attempt += 1) await login(EMAIL, 'wrong password attempt').expect(401)
      const locked = await login().expect(429)
      expect(locked.body.code).toBe('RATE_LIMITED')
      expect(await prisma.auditEvent.count({ where: { action: 'ACCOUNT_TEMPORARILY_LOCKED' } })).toBe(1)
    })

    it('a disabled account cannot sign in or keep using an existing session', async () => {
      await registerAndVerify()
      const cookie = sessionCookie(await login().expect(200))!.split(';')[0]
      await prisma.studentAccount.updateMany({ data: { status: 'DISABLED' } })
      await api().get('/api/auth/me').set('Cookie', cookie).expect(401)
      expect((await login().expect(403)).body.code).toBe('ACCOUNT_DISABLED')
    })

    it('rejects state-changing requests from a foreign origin', async () => {
      const response = await api().post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: EMAIL, password: PASSWORD }).expect(403)
      expect(response.body.code).toBe('FORBIDDEN_ORIGIN')
      await api().post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: EMAIL, password: PASSWORD }).expect(401)
    })

    it('allows CORS with credentials only for the configured frontend', async () => {
      const allowed = await api().options('/api/auth/login').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST')
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173')
      expect(allowed.headers['access-control-allow-credentials']).toBe('true')
      const other = await api().options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST')
      expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example')
    })
  })

  describe('password reset', () => {
    it('resets the password, signs out every session and makes the token single-use', async () => {
      await registerAndVerify()
      const cookie = sessionCookie(await login().expect(200))!.split(';')[0]
      const unknown = await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(202)
      const known = await api().post('/api/auth/forgot-password').send({ email: EMAIL }).expect(202)
      expect(known.body).toEqual(unknown.body)
      const token = mail.lastToken(EMAIL)
      expect(mail.sent.at(-1)!.text).toContain('/reset-password#token=')
      await api().post('/api/auth/reset-password').send({ token, password: 'short' }).expect(400)
      await api().post('/api/auth/reset-password').send({ token, password: 'a brand new long passphrase' }).expect(200, { passwordReset: true })
      await api().get('/api/auth/me').set('Cookie', cookie).expect(401)
      await login().expect(401)
      await login(EMAIL, 'a brand new long passphrase').expect(200)
      expect((await api().post('/api/auth/reset-password').send({ token, password: 'another new passphrase' }).expect(400)).body.code).toBe('INVALID_OR_EXPIRED_TOKEN')
    })

    it('a verification token cannot be used as a reset token', async () => {
      await api().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202)
      await api().post('/api/auth/reset-password').send({ token: mail.lastToken(EMAIL), password: 'a brand new long passphrase' }).expect(400)
    })
  })

  it('records security events without secrets in the audit log', async () => {
    await registerAndVerify()
    await login().expect(200)
    const events = await prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' } })
    expect(events.map((event) => event.action)).toEqual(['ACCOUNT_REGISTERED', 'EMAIL_VERIFIED', 'LOGIN_SUCCEEDED'])
    expect(JSON.stringify(events)).not.toContain(PASSWORD)
  })
})

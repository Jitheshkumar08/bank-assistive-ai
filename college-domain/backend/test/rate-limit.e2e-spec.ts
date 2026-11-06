import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { CapturingEmailSender, createTestApp, resetTestDatabase } from './helpers.js'

describe('Rate limiting (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let api: Awaited<ReturnType<typeof createTestApp>>['api']

  beforeAll(async () => { ({ app, prisma, api } = await createTestApp({ email: new CapturingEmailSender(), env: { RATE_LIMIT_AUTH: '3', RATE_LIMIT_EMAIL: '2' } })) })
  afterAll(async () => { await app?.close() })
  beforeEach(async () => { await resetTestDatabase(prisma) })

  it('limits login attempts per client and says when to retry', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) await api().post('/api/auth/login').send({ email: 'x@example.com', password: 'whatever' }).expect(401)
    const limited = await api().post('/api/auth/login').send({ email: 'x@example.com', password: 'whatever' }).expect(429)
    expect(limited.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' })
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('limits email-sending endpoints separately', async () => {
    await api().post('/api/auth/forgot-password').send({ email: 'a@example.com' }).expect(202)
    await api().post('/api/auth/forgot-password').send({ email: 'b@example.com' }).expect(202)
    await api().post('/api/auth/forgot-password').send({ email: 'c@example.com' }).expect(429)
    await api().post('/api/auth/register').send({ email: 'd@example.com', password: 'a long enough passphrase' }).expect(202)
  })

  it('does not rate-limit the health check', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await api().get('/api/health').expect(200)
  })
})

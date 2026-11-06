import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { createTestApp, resetTestDatabase } from './helpers.js'

describe('No email provider configured (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let api: Awaited<ReturnType<typeof createTestApp>>['api']

  beforeAll(async () => { ({ app, prisma, api } = await createTestApp({ email: null })) })
  afterAll(async () => { await app?.close() })
  beforeEach(async () => { await resetTestDatabase(prisma) })

  it.each([
    ['/api/auth/register', { email: 'student@example.com', password: 'a long enough passphrase' }],
    ['/api/auth/resend-verification', { email: 'student@example.com' }],
    ['/api/auth/forgot-password', { email: 'student@example.com' }],
  ])('%s answers 503 honestly and changes nothing', async (path, body) => {
    const response = await api().post(path).send(body).expect(503)
    expect(response.body).toMatchObject({ statusCode: 503, code: 'EMAIL_PROVIDER_NOT_CONFIGURED' })
    expect(response.body.message).not.toMatch(/sent|check your inbox/i)
    expect(await prisma.studentAccount.count()).toBe(0)
    expect(await prisma.accountToken.count()).toBe(0)
  })

  it('login and health keep working', async () => {
    await api().get('/api/health').expect(200)
    expect((await api().post('/api/auth/login').send({ email: 'student@example.com', password: 'x' }).expect(401)).body.code).toBe('INVALID_CREDENTIALS')
  })
})

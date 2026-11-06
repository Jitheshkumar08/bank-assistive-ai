import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { CapturingEmailSender, createTestApp, expectNoSecrets, provisionStaff, resetTestDatabase, sessionCookie } from './helpers.js'

// The public origin printed in QR codes comes from configuration only (here: a deployment-like https origin).
const PUBLIC_APP_URL = 'https://campusguide.nitte.example'
const STUDENT = { email: 'qr.student.fixture@example.com', password: 'fixture student passphrase' }
const DESK = 'campusguide:college/nmamit?area=admissions-desk'
const deskLink = `${PUBLIC_APP_URL}/scan?qr=${encodeURIComponent(DESK)}`

describe('QR Management (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let api: Awaited<ReturnType<typeof createTestApp>>['api']
  const mail = new CapturingEmailSender()
  let superAdmin: string
  let collegeAdmin: string

  beforeAll(async () => { ({ app, prisma, api } = await createTestApp({ email: mail, env: { FRONTEND_ORIGIN: PUBLIC_APP_URL } })) })
  afterAll(async () => { await app?.close() })
  beforeEach(async () => {
    mail.sent.length = 0
    await resetTestDatabase(prisma)
    ;({ superAdmin, collegeAdmin } = await provisionStaff(app, api, mail))
  })

  async function studentCookie() {
    await api().post('/api/auth/register').send(STUDENT).expect(202)
    await api().post('/api/auth/verify-email').send({ token: mail.lastToken(STUDENT.email) }).expect(200)
    return sessionCookie(await api().post('/api/auth/login').send(STUDENT).expect(200))!.split(';')[0]
  }
  const deskId = async () => (await prisma.institutionQrCode.findFirstOrThrow({ where: { areaSlug: 'admissions-desk' } })).id
  const binary = (request: ReturnType<ReturnType<typeof api>['get']>) => request.buffer(true).parse((response, done) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => done(null, Buffer.concat(chunks)))
  })

  describe('Super Admin', () => {
    it('lists placements with the payload and a scan link on the configured public URL (never the request Host)', async () => {
      const response = await api().get('/api/super-admin/qr-codes').set('Cookie', superAdmin).set('Host', 'evil.example').set('X-Forwarded-Host', 'evil.example').expect(200)
      expect(response.body.publicAppUrl).toBe(PUBLIC_APP_URL)
      expect(response.body.items).toEqual([expect.objectContaining({
        areaSlug: 'admissions-desk', label: 'Admission desk', isActive: true, payload: DESK, scanUrl: deskLink, createdBy: null,
        institution: { id: 'nmamit', name: 'NMAM Institute of Technology', shortName: 'NMAMIT' },
      })])
      expect(JSON.stringify(response.body)).not.toMatch(/evil\.example|localhost/)
      expectNoSecrets(response.body)
    })

    it('creates a placement (audited), rejects duplicates and invalid input', async () => {
      const created = await api().post('/api/super-admin/qr-codes').set('Cookie', superAdmin).send({ institutionId: 'nmamit', areaSlug: 'library', label: '  Central Library entrance ' }).expect(201)
      expect(created.body).toMatchObject({ areaSlug: 'library', label: 'Central Library entrance', isActive: true, payload: 'campusguide:college/nmamit?area=library', createdBy: 'Fixture Super Admin' })
      const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'QR_PLACEMENT_CREATED' } })
      expect(audit).toMatchObject({ actorType: 'SUPER_ADMIN', entityType: 'InstitutionQrCode', entityId: created.body.id, metadata: { institutionId: 'nmamit', areaSlug: 'library', label: 'Central Library entrance' } })

      const duplicate = await api().post('/api/super-admin/qr-codes').set('Cookie', superAdmin).send({ institutionId: 'nmamit', areaSlug: 'admissions-desk', label: 'Another desk' }).expect(409)
      expect(duplicate.body.code).toBe('CONFLICT')
      for (const body of [
        { institutionId: 'nmamit', areaSlug: 'Bad Area', label: 'X label' }, { institutionId: 'nmamit', areaSlug: 'ok', label: '<script>' },
        { institutionId: 'other-college', areaSlug: 'desk', label: 'Desk' }, { institutionId: 'nmamit', areaSlug: 'desk', label: 'Desk', isActive: false },
        { institutionId: 'nmamit', areaSlug: 'desk', label: 'Desk', payload: 'https://evil.example' },
      ]) {
        expect((await api().post('/api/super-admin/qr-codes').set('Cookie', superAdmin).send(body).expect(400)).body.code).toBe('VALIDATION_FAILED')
      }
      expect(await prisma.institutionQrCode.count()).toBe(2)
    })

    it('downloads PNG and SVG rendered from the stored placement, without creating or changing anything', async () => {
      const id = await deskId()
      const before = await prisma.institutionQrCode.findUniqueOrThrow({ where: { id } })
      const png = await binary(api().get(`/api/super-admin/qr-codes/${id}/qr.png`).set('Cookie', superAdmin)).expect(200)
      expect(png.headers['content-type']).toBe('image/png')
      expect(png.headers['content-disposition']).toBe('attachment; filename="campusguide-qr-nmamit-admissions-desk.png"')
      expect(png.headers['cache-control']).toContain('no-store')
      expect((png.body as Buffer).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const svg = await binary(api().get(`/api/super-admin/qr-codes/${id}/qr.svg`).set('Cookie', superAdmin)).expect(200)
      expect(svg.headers['content-type']).toContain('image/svg+xml')
      const { renderQr } = await import('../src/qr-codes/qr-image.js')
      expect((svg.body as Buffer).toString('utf8')).toBe((await renderQr(deskLink, 'svg')).toString('utf8'))
      expect(await prisma.institutionQrCode.count()).toBe(1)
      expect(await prisma.institutionQrCode.findUniqueOrThrow({ where: { id } })).toEqual(before)
      await api().get('/api/super-admin/qr-codes/00000000-0000-4000-8000-000000000000/qr.png').set('Cookie', superAdmin).expect(404)
      await api().get('/api/super-admin/qr-codes/not-a-uuid/qr.png').set('Cookie', superAdmin).expect(400)
    })

    it('deactivates (scans rejected, nothing deleted) and reactivates (scans work again), each audited once', async () => {
      const id = await deskId()
      const scan = (payload: string) => api().post('/api/qr-context/validate').send({ payload })
      await scan(deskLink).expect(200)
      const off = await api().post(`/api/super-admin/qr-codes/${id}/deactivate`).set('Cookie', superAdmin).expect(200)
      expect(off.body).toMatchObject({ id, isActive: false, areaSlug: 'admissions-desk' })
      await api().post(`/api/super-admin/qr-codes/${id}/deactivate`).set('Cookie', superAdmin).expect(200)
      expect((await scan(DESK).expect(400)).body.code).toBe('INVALID_QR')
      expect((await scan(deskLink).expect(400)).body.code).toBe('INVALID_QR')
      expect(await prisma.institutionQrCode.count()).toBe(1)
      await api().post(`/api/super-admin/qr-codes/${id}/activate`).set('Cookie', superAdmin).expect(200)
      await scan(DESK).expect(200)
      const actions = (await prisma.auditEvent.findMany({ where: { entityType: 'InstitutionQrCode' }, orderBy: { createdAt: 'asc' } })).map((event) => event.action)
      expect(actions).toEqual(['QR_PLACEMENT_DEACTIVATED', 'QR_PLACEMENT_ACTIVATED'])
      const log = await api().get('/api/super-admin/audit-events?entityType=InstitutionQrCode').set('Cookie', superAdmin).expect(200)
      expect(log.body.items.map((item: { description: string }) => item.description)).toEqual(['Activated a QR placement', 'Deactivated a QR placement'])
      await api().post('/api/super-admin/qr-codes/00000000-0000-4000-8000-000000000000/deactivate').set('Cookie', superAdmin).expect(404)
    })
  })

  describe('College Admin', () => {
    it('lists and downloads only their own college’s codes', async () => {
      await prisma.institution.create({ data: { id: 'othercollege', name: 'Other College', shortName: 'OC' } })
      const other = await prisma.institutionQrCode.create({ data: { institutionId: 'othercollege', areaSlug: 'desk', label: 'Other desk' } })
      const list = await api().get('/api/admin/qr-codes').set('Cookie', collegeAdmin).expect(200)
      expect(list.body.items.map((item: { payload: string }) => item.payload)).toEqual([DESK])
      expect(list.body.items[0].scanUrl).toBe(deskLink)
      const id = await deskId()
      const png = await binary(api().get(`/api/admin/qr-codes/${id}/qr.png`).set('Cookie', collegeAdmin)).expect(200)
      expect((png.body as Buffer).subarray(0, 4).toString('hex')).toBe('89504e47')
      await api().get(`/api/admin/qr-codes/${id}/qr.svg`).set('Cookie', collegeAdmin).expect(200)
      await api().get(`/api/admin/qr-codes/${other.id}/qr.png`).set('Cookie', collegeAdmin).expect(404)
    })

    it('cannot create, activate or deactivate placements, or use the Super Admin QR API at all', async () => {
      const id = await deskId()
      await api().post('/api/super-admin/qr-codes').set('Cookie', collegeAdmin).send({ institutionId: 'nmamit', areaSlug: 'library', label: 'Library' }).expect(403)
      await api().post(`/api/super-admin/qr-codes/${id}/deactivate`).set('Cookie', collegeAdmin).expect(403)
      await api().post(`/api/super-admin/qr-codes/${id}/activate`).set('Cookie', collegeAdmin).expect(403)
      await api().get('/api/super-admin/qr-codes').set('Cookie', collegeAdmin).expect(403)
      await api().get(`/api/super-admin/qr-codes/${id}/qr.png`).set('Cookie', collegeAdmin).expect(403)
      // There are no write routes under /admin/qr-codes.
      await api().post('/api/admin/qr-codes').set('Cookie', collegeAdmin).send({ institutionId: 'nmamit', areaSlug: 'library', label: 'Library' }).expect(404)
      await api().post(`/api/admin/qr-codes/${id}/deactivate`).set('Cookie', collegeAdmin).expect(404)
      expect(await prisma.institutionQrCode.findUniqueOrThrow({ where: { id } })).toMatchObject({ isActive: true })
      expect(await prisma.institutionQrCode.count()).toBe(1)
    })
  })

  it('students and signed-out visitors get no QR management access', async () => {
    const id = await deskId()
    const student = await studentCookie()
    for (const [method, path] of [['get', '/api/super-admin/qr-codes'], ['get', '/api/admin/qr-codes'], ['get', `/api/admin/qr-codes/${id}/qr.png`], ['post', `/api/super-admin/qr-codes/${id}/deactivate`]] as const) {
      await api()[method](path).set('Cookie', student).expect(403)
      await api()[method](path).expect(401)
    }
  })

  describe('scanner compatibility', () => {
    it('accepts the original printed payload and the new scan link; rejects links to other sites, paths or extra parameters', async () => {
      const scan = (payload: string) => api().post('/api/qr-context/validate').send({ payload })
      expect((await scan(DESK).expect(200)).body).toEqual({ collegeId: 'nmamit', collegeName: 'NMAM Institute of Technology', shortName: 'NMAMIT', area: 'admissions-desk' })
      expect((await scan(deskLink).expect(200)).body.area).toBe('admissions-desk')
      for (const payload of [
        `https://evil.example/scan?qr=${encodeURIComponent(DESK)}`, `http://localhost:5173/scan?qr=${encodeURIComponent(DESK)}`,
        `${PUBLIC_APP_URL}/login?qr=${encodeURIComponent(DESK)}`, `${deskLink}&next=https://evil.example`, `${deskLink}#x`,
        `${PUBLIC_APP_URL}/scan?qr=${encodeURIComponent('campusguide:college/nmamit?area=unknown-desk')}`, `${PUBLIC_APP_URL}/scan`,
      ]) {
        const response = await scan(payload).expect(400)
        expect(response.body.code).toBe('INVALID_QR')
        expect(JSON.stringify(response.body)).not.toContain('evil')
      }
    })
  })
})

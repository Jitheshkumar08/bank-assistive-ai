import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { CapturingEmailSender, createTestApp, expectNoSecrets, resetTestDatabase, sessionCookie } from './helpers.js'

// Synthetic TEST-ONLY fixtures, created inside the disposable test database and deleted before every test.
const ASHA = { email: 'asha.fixture@example.com', password: 'fixture passphrase for asha' }
const RAVI = { email: 'ravi.fixture@example.com', password: 'fixture passphrase for ravi' }

describe('QR context and admission verification (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let api: Awaited<ReturnType<typeof createTestApp>>['api']
  const mail = new CapturingEmailSender()

  beforeAll(async () => { ({ app, prisma, api } = await createTestApp({ email: mail })) })
  afterAll(async () => { await app?.close() })
  beforeEach(async () => { mail.sent.length = 0; await resetTestDatabase(prisma) })

  async function signedIn(user: { email: string; password: string }) {
    await api().post('/api/auth/register').send(user).expect(202)
    await api().post('/api/auth/verify-email').send({ token: mail.lastToken(user.email) }).expect(200)
    return sessionCookie(await api().post('/api/auth/login').send(user).expect(200))!.split(';')[0]
  }
  async function fixtureRecord(nucatReference: string, officialEmail: string | null, branch: string | null) {
    const allocated = branch ? await prisma.branch.create({ data: { institutionId: 'nmamit', code: `T-${nucatReference}`, name: branch } }) : null
    return prisma.admissionRecord.create({ data: { institutionId: 'nmamit', admissionYear: 2025, nucatReference, studentName: `Fixture ${nucatReference}`, officialEmail, nucatRank: 4321, allocatedBranchId: allocated?.id, admissionStatus: 'Fixture status' } })
  }

  describe('POST /api/qr-context/validate', () => {
    it('accepts the approved NMAMIT admission-desk QR', async () => {
      const response = await api().post('/api/qr-context/validate').send({ payload: 'campusguide:college/nmamit?area=admissions-desk' }).expect(200)
      expect(response.body).toEqual({ collegeId: 'nmamit', collegeName: 'NMAM Institute of Technology', shortName: 'NMAMIT', area: 'admissions-desk' })
    })

    it.each([
      'campusguide:college/othercollege', 'campusguide:college/nmamit?area=library', 'https://example.com/?rank=1', 'campusguide:college/nmamit?area=admissions-desk&name=x',
    ])('rejects %s', async (payload) => {
      const response = await api().post('/api/qr-context/validate').send({ payload }).expect(400)
      expect(response.body.code).toBe('INVALID_QR')
      expect(JSON.stringify(response.body)).not.toContain(payload)
    })

    it('rejects an inactive institution', async () => {
      await prisma.institution.update({ where: { id: 'nmamit' }, data: { isActive: false } })
      await api().post('/api/qr-context/validate').send({ payload: 'campusguide:college/nmamit' }).expect(400)
    })
  })

  describe('admission result endpoints', () => {
    it('require a signed-in, verified student', async () => {
      await api().get('/api/students/me/admission-result?collegeId=nmamit').expect(401)
      await api().post('/api/students/me/admission-verification').send({ collegeId: 'nmamit', nucatReference: 'NU-1' }).expect(401)
    })

    it('without imported data: NOT_VERIFIED, then a generic mismatch — never a fabricated result', async () => {
      const cookie = await signedIn(ASHA)
      const before = await api().get('/api/students/me/admission-result?collegeId=nmamit').set('Cookie', cookie).expect(404)
      expect(before.body.code).toBe('NOT_VERIFIED')
      const attempt = await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: 'NU2026-0001' }).expect(400)
      expect(attempt.body.code).toBe('REFERENCE_MISMATCH')
      expect(await prisma.admissionRecord.count()).toBe(0)
    })

    it('verifies the signed-in student’s own record and then returns only that result', async () => {
      await fixtureRecord('NU2026-0001', ASHA.email, 'Fixture Branch A')
      const cookie = await signedIn(ASHA)
      const verified = await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: ' nu2026-0001 ' }).expect(200)
      expect(verified.body.result).toEqual({ studentName: 'Fixture NU2026-0001', nucatRank: 4321, allocatedBranch: 'Fixture Branch A', admissionStatus: 'Fixture status', admissionYear: 2025, verifiedAt: expect.any(String) })
      expectNoSecrets(verified.body)
      const again = await api().get('/api/students/me/admission-result?collegeId=nmamit').set('Cookie', cookie).expect(200)
      expect(again.body.result.studentName).toBe('Fixture NU2026-0001')
      expect(Object.keys(again.body.result).sort()).toEqual(['admissionStatus', 'admissionYear', 'allocatedBranch', 'nucatRank', 'studentName', 'verifiedAt'])
    })

    it('keeps null rank / branch as null (unpublished / unallocated)', async () => {
      await prisma.admissionRecord.create({ data: { institutionId: 'nmamit', admissionYear: 2026, nucatReference: 'NU2026-0009', studentName: 'Fixture Pending', officialEmail: ASHA.email } })
      const cookie = await signedIn(ASHA)
      const response = await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: 'NU2026-0009' }).expect(200)
      expect(response.body.result).toMatchObject({ nucatRank: null, allocatedBranch: null, admissionStatus: null })
    })

    it('a student cannot claim another student’s reference, and the answer reveals nothing about it', async () => {
      await fixtureRecord('NU2026-0001', ASHA.email, 'Fixture Branch A')
      const raviCookie = await signedIn(RAVI)
      const response = await api().post('/api/students/me/admission-verification').set('Cookie', raviCookie).send({ collegeId: 'nmamit', nucatReference: 'NU2026-0001' }).expect(400)
      expect(response.body.code).toBe('REFERENCE_MISMATCH')
      expect(JSON.stringify(response.body)).not.toMatch(/Fixture|4321|Branch A|asha/i)
      expect((await prisma.admissionRecord.findFirstOrThrow()).studentAccountId).toBeNull()
    })

    it('a record without an official email cannot be claimed (fails closed)', async () => {
      await fixtureRecord('NU2026-0002', null, null)
      const cookie = await signedIn(ASHA)
      await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: 'NU2026-0002' }).expect(400)
    })

    it('a record already claimed by one account cannot be claimed by another', async () => {
      const record = await fixtureRecord('NU2026-0003', ASHA.email, null)
      const raviCookie = await signedIn(RAVI)
      const ravi = await prisma.studentAccount.findUniqueOrThrow({ where: { email: RAVI.email } })
      await prisma.admissionRecord.update({ where: { id: record.id }, data: { studentAccountId: ravi.id, officialEmail: RAVI.email } })
      const ashaCookie = await signedIn(ASHA)
      await api().post('/api/students/me/admission-verification').set('Cookie', ashaCookie).send({ collegeId: 'nmamit', nucatReference: 'NU2026-0003' }).expect(400)
      await api().get('/api/students/me/admission-result?collegeId=nmamit').set('Cookie', raviCookie).expect(200)
    })

    it('never accepts identity or results from the browser', async () => {
      const cookie = await signedIn(ASHA)
      for (const extra of [{ studentId: 'someone' }, { studentName: 'X' }, { nucatRank: 1 }, { email: RAVI.email }]) {
        const response = await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: 'NU2026-0001', ...extra }).expect(400)
        expect(response.body.code).toBe('VALIDATION_FAILED')
      }
    })

    it('rejects an unknown college and malformed input', async () => {
      const cookie = await signedIn(ASHA)
      expect((await api().get('/api/students/me/admission-result?collegeId=other').set('Cookie', cookie).expect(404)).body.code).toBe('NOT_FOUND')
      await api().get('/api/students/me/admission-result').set('Cookie', cookie).expect(400)
      await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: "NU'; DROP TABLE x;--" }).expect(400)
    })
  })

  describe('GET /api/students/me/admission-details (QR flow, matched by the session email)', () => {
    const DETAILS = '/api/students/me/admission-details?collegeId=nmamit&area=admissions-desk'
    // Synthetic fixture amounts (deliberately not the official ones) for the database-backed lookup.
    async function fixtureFee(programName: string, category: 'GENERAL' | 'SCHOLARSHIP' | 'NRI', annualTuition: number | null, admissionYear = 2026) {
      const { normalizeProgramName } = await import('../src/fees/fee-calculation.js')
      return prisma.feeSchedule.create({ data: {
        institutionId: 'nmamit', admissionYear, academicYear: `${admissionYear}-${String(admissionYear + 1).slice(2)}`, programName, programKey: normalizeProgramName(programName),
        category, annualTuition, annualExamFee: 1111, sourceUrl: 'https://example.com/fixture-fees.pdf', sourceSha256: 'f'.repeat(64),
      } })
    }
    async function record(nucatReference: string, data: { officialEmail?: string | null; branch?: string | null; feeCategory?: 'GENERAL' | 'SCHOLARSHIP' | 'NRI' | null; admissionYear?: number; nucatRank?: number | null } = {}) {
      const branch = data.branch === undefined ? 'Fixture Programme' : data.branch
      const allocated = branch ? await prisma.branch.upsert({ where: { institutionId_name: { institutionId: 'nmamit', name: branch } }, create: { institutionId: 'nmamit', code: `T-${nucatReference}`, name: branch }, update: {} }) : null
      return prisma.admissionRecord.create({ data: {
        institutionId: 'nmamit', admissionYear: data.admissionYear ?? 2026, nucatReference, studentName: `Fixture ${nucatReference}`,
        officialEmail: data.officialEmail === undefined ? ASHA.email : data.officialEmail, nucatRank: data.nucatRank === undefined ? 4321 : data.nucatRank,
        allocatedBranchId: allocated?.id, feeCategory: data.feeCategory === undefined ? 'GENERAL' : data.feeCategory,
      } })
    }

    it('requires a signed-in student; an expired or revoked session gets 401 (no other prompt)', async () => {
      await api().get(DETAILS).expect(401)
      const cookie = await signedIn(ASHA)
      await prisma.studentSession.updateMany({ data: { revokedAt: new Date() } })
      expect((await api().get(DETAILS).set('Cookie', cookie).expect(401)).body.code).toBe('UNAUTHENTICATED')
      const other = await signedIn(RAVI)
      await prisma.studentSession.updateMany({ where: { revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } })
      await api().get(DETAILS).set('Cookie', other).expect(401)
    })

    it('is for student accounts only', async () => {
      const cookie = await signedIn(ASHA)
      await prisma.studentAccount.update({ where: { email: ASHA.email }, data: { role: 'COLLEGE_ADMIN', institutionId: 'nmamit' } })
      await api().get(DETAILS).set('Cookie', cookie).expect(403)
    })

    it('finds the record by the session account’s email and returns details with the confirmed fee', async () => {
      await record('NU2026-0101')
      await fixtureFee('Fixture Programme', 'GENERAL', 123000)
      await fixtureFee('Fixture Programme', 'NRI', 456000)
      const cookie = await signedIn(ASHA)
      const response = await api().get(DETAILS).set('Cookie', cookie).expect(200)
      expect(response.body).toEqual({ details: {
        studentName: 'Fixture NU2026-0101', nucatRank: 4321, allocatedBranch: 'Fixture Programme', admissionStatus: null, admissionYear: 2026,
        fee: { status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 124111 },
      } })
      expectNoSecrets(response.body)
      expect(JSON.stringify(response.body)).not.toMatch(/officialEmail|nucatReference|studentAccountId|asha.fixture/i)
      // Read-only: the QR flow does not claim or change the official record.
      expect((await prisma.admissionRecord.findFirstOrThrow()).studentAccountId).toBeNull()
    })

    it('matches the email case-insensitively and works without an area', async () => {
      await record('NU2026-0102', { officialEmail: 'ASHA.Fixture@Example.com' })
      const cookie = await signedIn(ASHA)
      await api().get('/api/students/me/admission-details?collegeId=nmamit').set('Cookie', cookie).expect(200)
    })

    it('answers NO_ADMISSION_RECORD when nothing matches — revealing nothing about other students', async () => {
      await record('NU2026-0103', { officialEmail: RAVI.email })
      await record('NU2026-0104', { officialEmail: null })
      const cookie = await signedIn(ASHA)
      const response = await api().get(DETAILS).set('Cookie', cookie).expect(404)
      expect(response.body.code).toBe('NO_ADMISSION_RECORD')
      expect(JSON.stringify(response.body)).not.toMatch(/Fixture|ravi|NU2026/i)
    })

    it('cannot be pointed at another student’s record by the request', async () => {
      await record('NU2026-0105', { officialEmail: RAVI.email })
      const ravi = await signedIn(RAVI)
      const asha = await signedIn(ASHA)
      const raviId = (await prisma.studentAccount.findUniqueOrThrow({ where: { email: RAVI.email } })).id
      for (const extra of [`&email=${encodeURIComponent(RAVI.email)}`, `&studentId=${raviId}`, '&nucatReference=NU2026-0105']) {
        expect((await api().get(DETAILS + extra).set('Cookie', asha).expect(400)).body.code).toBe('VALIDATION_FAILED')
      }
      await api().get(DETAILS).set('Cookie', asha).set('X-Student-Email', RAVI.email).expect(404)
      expect((await api().get(DETAILS).set('Cookie', ravi).expect(200)).body.details.studentName).toBe('Fixture NU2026-0105')
    })

    it('never shows a record that another account has already verified', async () => {
      const claimed = await record('NU2026-0106')
      await signedIn(RAVI)
      const ravi = await prisma.studentAccount.findUniqueOrThrow({ where: { email: RAVI.email } })
      await prisma.admissionRecord.update({ where: { id: claimed.id }, data: { studentAccountId: ravi.id } })
      const cookie = await signedIn(ASHA)
      await api().get(DETAILS).set('Cookie', cookie).expect(404)
    })

    it('uses the newest admission year, and refuses two records for the same email in that year', async () => {
      await record('NU2025-0001', { admissionYear: 2025 })
      await record('NU2026-0107', { admissionYear: 2026, nucatRank: 99 })
      const cookie = await signedIn(ASHA)
      expect((await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details).toMatchObject({ admissionYear: 2026, nucatRank: 99 })
      await record('NU2026-0108', { admissionYear: 2026 })
      const response = await api().get(DETAILS).set('Cookie', cookie).expect(409)
      expect(response.body.code).toBe('AMBIGUOUS_ADMISSION_RECORD')
      expect(JSON.stringify(response.body)).not.toMatch(/NU2026|Fixture/)
    })

    it('keeps missing rank / branch null and marks the fee as requiring confirmation', async () => {
      await record('NU2026-0109', { branch: null, nucatRank: null })
      const cookie = await signedIn(ASHA)
      expect((await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details).toMatchObject({
        nucatRank: null, allocatedBranch: null, fee: { status: 'REQUIRES_CONFIRMATION' },
      })
    })

    it.each([
      ['no fee category recorded (scholarship information missing — never assumed General)', { feeCategory: null }, [['Fixture Programme', 'GENERAL', 123000, 2026], ['Fixture Programme', 'SCHOLARSHIP', 100000, 2026]]],
      ['no schedule for the branch', {}, []],
      ['a schedule only for another branch', {}, [['Other Fixture Programme', 'GENERAL', 123000, 2026]]],
      ['a schedule only for another year', {}, [['Fixture Programme', 'GENERAL', 1, 2025]]],
      ['"NA" for the category', { feeCategory: 'NRI' as const }, [['Fixture Programme', 'NRI', null, 2026]]],
      ['a Scholarship record but no Scholarship row (no deduction derived from the General fee)', { feeCategory: 'SCHOLARSHIP' as const }, [['Fixture Programme', 'GENERAL', 123000, 2026]]],
    ] as const)('fee requires confirmation — and nothing else is said — with %s', async (_label, data, fees) => {
      await record('NU2026-0110', data)
      for (const [name, category, amount, year] of fees) await fixtureFee(name, category, amount, year)
      const cookie = await signedIn(ASHA)
      const { fee } = (await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details
      expect(fee).toEqual({ status: 'REQUIRES_CONFIRMATION' })
    })

    it('an officially confirmed scholarship gives the official Scholarship fee as the final amount — no breakdown exposed', async () => {
      await record('NU2026-0113', { feeCategory: 'SCHOLARSHIP' })
      await fixtureFee('Fixture Programme', 'GENERAL', 123000)
      await fixtureFee('Fixture Programme', 'SCHOLARSHIP', 100000)
      const cookie = await signedIn(ASHA)
      const response = await api().get(DETAILS).set('Cookie', cookie).expect(200)
      expect(response.body.details.fee).toEqual({ status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 101111 })
      // Neither the original fee, the deduction, the category nor any other figure appears anywhere in the response.
      const text = JSON.stringify(response.body)
      expect(text).not.toMatch(/scholarship|deduction|tuition|exam|category|breakdown|original|reason|sourceUrl|programName|period/i)
      for (const figure of ['123000', '124111', '100000', '23000', '22000']) expect(text).not.toContain(figure)
    })

    it('different branches and admission years each get their own official fee; a student never sees another student’s fee', async () => {
      await record('NU2026-0114', { officialEmail: ASHA.email, branch: 'Fixture Branch A', admissionYear: 2026, feeCategory: 'GENERAL' })
      await record('NU2025-0114', { officialEmail: RAVI.email, branch: 'Fixture Branch B', admissionYear: 2025, feeCategory: 'NRI' })
      await fixtureFee('Fixture Branch A', 'GENERAL', 200000, 2026)
      await fixtureFee('Fixture Branch A', 'GENERAL', 190000, 2025)
      await fixtureFee('Fixture Branch B', 'NRI', 300000, 2025)
      await fixtureFee('Fixture Branch B', 'NRI', 310000, 2026)
      const asha = await signedIn(ASHA)
      const ravi = await signedIn(RAVI)
      const ashaBody = (await api().get(DETAILS).set('Cookie', asha).expect(200)).body
      const raviBody = (await api().get(DETAILS).set('Cookie', ravi).expect(200)).body
      expect(ashaBody.details).toMatchObject({ allocatedBranch: 'Fixture Branch A', admissionYear: 2026, fee: { status: 'CONFIRMED', finalPayableAmount: 201111 } })
      expect(raviBody.details).toMatchObject({ allocatedBranch: 'Fixture Branch B', admissionYear: 2025, fee: { status: 'CONFIRMED', finalPayableAmount: 301111 } })
      expect(JSON.stringify(ashaBody)).not.toContain('301111')
      // Fee inputs from the request are refused, never used.
      const raviId = (await prisma.studentAccount.findUniqueOrThrow({ where: { email: RAVI.email } })).id
      for (const extra of [`&studentId=${raviId}`, `&email=${encodeURIComponent(RAVI.email)}`, '&feeCategory=SCHOLARSHIP', '&finalPayableAmount=1', '&scholarshipAmount=100000', '&branch=Fixture%20Branch%20B', '&admissionYear=2025']) {
        expect((await api().get(DETAILS + extra).set('Cookie', asha).expect(400)).body.code).toBe('VALIDATION_FAILED')
      }
      const spoofed = await api().get(DETAILS).set('Cookie', asha).set('X-Student-Email', RAVI.email).send({ feeCategory: 'SCHOLARSHIP', finalPayableAmount: 1, scholarshipAmount: 100000 }).expect(200)
      expect(spoofed.body.details.fee).toEqual({ status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 201111 })
    })

    it('unconfirmed fee data is never used: the PENDING official file cannot be loaded, so the fee requires confirmation', async () => {
      const { readFileSync } = await import('node:fs')
      const { feeRowsFromFile } = await import('../src/fees/fee-schedule-file.js')
      const file = JSON.parse(readFileSync(new URL('../data/fee-schedules/nmamit-btech-2026-27.json', import.meta.url), 'utf8'))
      expect(file.confirmation.status).toBe('PENDING')
      expect(() => feeRowsFromFile(file)).toThrow(/not been confirmed/)
      expect(await prisma.feeSchedule.count()).toBe(0)
      await record('NU2026-0115', { branch: 'Computer Science', feeCategory: 'GENERAL' })
      const cookie = await signedIn(ASHA)
      expect((await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details.fee).toEqual({ status: 'REQUIRES_CONFIRMATION' })
    })

    it('applies the confirmed official 2026-27 schedule once loaded (Computer Science, General = 3,50,000 + 10,000)', async () => {
      const { readFileSync } = await import('node:fs')
      const { feeRowsFromFile } = await import('../src/fees/fee-schedule-file.js')
      const { FeeService } = await import('../src/fees/fee.service.js')
      const file = JSON.parse(readFileSync(new URL('../data/fee-schedules/nmamit-btech-2026-27.json', import.meta.url), 'utf8'))
      const loaded = await app.get(FeeService).load(feeRowsFromFile({ ...file, confirmation: { status: 'CONFIRMED', confirmedBy: 'Test run', confirmedOn: '2026-10-27' } }))
      expect(loaded).toEqual({ created: 42, updated: 0 })
      expect(await app.get(FeeService).load(feeRowsFromFile({ ...file, confirmation: { status: 'CONFIRMED', confirmedBy: 'Test run', confirmedOn: '2026-10-27' } }))).toEqual({ created: 0, updated: 42 })
      await record('NU2026-0111', { branch: 'computer science', feeCategory: 'GENERAL' })
      const cookie = await signedIn(ASHA)
      expect((await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details.fee).toEqual({ status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 360000 })
      expect(await prisma.auditEvent.count({ where: { action: 'FEE_SCHEDULE_LOADED' } })).toBe(2)
    })

    it('rejects a deactivated QR placement or college and malformed context', async () => {
      await record('NU2026-0112')
      const cookie = await signedIn(ASHA)
      await prisma.institutionQrCode.updateMany({ data: { isActive: false } })
      expect((await api().get(DETAILS).set('Cookie', cookie).expect(400)).body.code).toBe('INVALID_QR')
      await api().get('/api/students/me/admission-details?collegeId=nmamit&area=library').set('Cookie', cookie).expect(400)
      await api().get('/api/students/me/admission-details?collegeId=nmamit&area=Bad%20Area').set('Cookie', cookie).expect(400)
      await prisma.institution.update({ where: { id: 'nmamit' }, data: { isActive: false } })
      expect((await api().get('/api/students/me/admission-details?collegeId=nmamit').set('Cookie', cookie).expect(400)).body.code).toBe('INVALID_QR')
      await api().get('/api/students/me/admission-details').set('Cookie', cookie).expect(400)
    })
  })
})

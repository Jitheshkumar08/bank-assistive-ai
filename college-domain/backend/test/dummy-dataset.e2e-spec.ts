import type { INestApplication } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { CapturingEmailSender, createTestApp, expectNoSecrets, provisionStaff, resetTestDatabase, sessionCookie } from './helpers.js'

// TEMPORARY verification of the fictional dummy dataset (../campusguide_dummy_admissions_2026_27.*) against the real
// import → login → QR → admission-details flow. Runs only in the disposable test database (reset before every test).
const ROOT = new URL('../../', import.meta.url)
const CSV = readFileSync(new URL('campusguide_dummy_admissions_2026_27.csv', ROOT))
const XLSX = readFileSync(new URL('campusguide_dummy_admissions_2026_27.xlsx', ROOT))
const EXPECTED = CSV.toString('utf8').trim().split(/\r?\n/).slice(1).map((line) => {
  const [studentName, email, rank, branch, reference, , category] = line.split(',')
  return { studentName, email, nucatRank: Number(rank), branch, reference, category: category.toUpperCase() }
})
const DETAILS = '/api/students/me/admission-details?collegeId=nmamit&area=admissions-desk'
const passwordFor = (email: string) => `dummy dataset test passphrase ${email}`

describe('Dummy admission dataset 2026-27 (e2e, test database only)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let api: Awaited<ReturnType<typeof createTestApp>>['api']
  let admin: string
  const mail = new CapturingEmailSender()

  beforeAll(async () => { ({ app, prisma, api } = await createTestApp({ email: mail })) })
  afterAll(async () => { await app?.close() })
  beforeEach(async () => {
    mail.sent.length = 0
    await resetTestDatabase(prisma)
    ;({ collegeAdmin: admin } = await provisionStaff(app, api, mail))
  })

  const preview = (file: Buffer, name: string) =>
    api().post('/api/admin/admission-imports/preview').set('Cookie', admin).field('admissionYear', '2026').attach('file', file, name)
  const commit = (id: string) => api().post(`/api/admin/admission-imports/${id}/commit`).set('Cookie', admin).send({ duplicatePolicy: 'SKIP_EXISTING' })
  async function importCsv() {
    const response = await preview(CSV, 'campusguide_dummy_admissions_2026_27.csv').expect(201)
    return (await commit(response.body.id).expect(200)).body
  }
  async function signUpAndLogIn(email: string) {
    const user = { email, password: passwordFor(email) }
    await api().post('/api/auth/register').send(user).expect(202)
    await api().post('/api/auth/verify-email').send({ token: mail.lastToken(email) }).expect(200)
    return sessionCookie(await api().post('/api/auth/login').send(user).expect(200))!.split(';')[0]
  }

  it('CSV and XLSX preview identically: 10 valid, 0 invalid, all 8 columns mapped', async () => {
    for (const [file, name] of [[CSV, 'dummy.csv'], [XLSX, 'dummy.xlsx']] as const) {
      const response = await preview(file, name).expect(201)
      expect(response.body.counts).toMatchObject({ total: 10, valid: 10, invalid: 0, duplicates: 0, new: 10 })
      expect(response.body.columns.ignored).toEqual([])
      expect(response.body.columns.matched.map((column: { field: string }) => column.field).sort()).toEqual(
        ['admissionStatus', 'admissionYear', 'allocatedBranch', 'feeCategory', 'nucatRank', 'nucatReference', 'officialEmail', 'studentName'])
    }
    expect(await prisma.admissionRecord.count()).toBe(0)
  })

  it('imports 10 records with SKIP_EXISTING; a second import skips all 10 and changes nothing', async () => {
    expect((await importCsv()).counts).toMatchObject({ inserted: 10, skipped: 0, rejected: 0 })
    const stored = await prisma.admissionRecord.findMany({ include: { allocatedBranch: true }, orderBy: { nucatReference: 'asc' } })
    expect(stored.map((r) => ({ ref: r.nucatReference, name: r.studentName, email: r.officialEmail, rank: r.nucatRank, branch: r.allocatedBranch?.name, year: r.admissionYear, category: r.feeCategory, status: r.admissionStatus })))
      .toEqual(EXPECTED.map((e) => ({ ref: e.reference.replace(/-/g, '-').toUpperCase(), name: e.studentName, email: e.email, rank: e.nucatRank, branch: e.branch, year: 2026, category: e.category, status: 'TEST DATA' })))
    const before = JSON.stringify(stored)
    const again = await preview(CSV, 'again.csv').expect(201)
    expect(again.body.counts).toMatchObject({ valid: 10, new: 0, unchanged: 10, changed: 0 })
    expect((await commit(again.body.id).expect(200)).body.counts).toMatchObject({ inserted: 0, updated: 0 })
    expect(JSON.stringify(await prisma.admissionRecord.findMany({ include: { allocatedBranch: true }, orderBy: { nucatReference: 'asc' } }))).toBe(before)
  })

  it('every student, after normal signup + email verification + login, sees exactly their own record via the QR context', async () => {
    await importCsv()
    for (const expected of EXPECTED) {
      const cookie = await signUpAndLogIn(expected.email)
      const response = await api().get(DETAILS).set('Cookie', cookie).expect(200)
      expectNoSecrets(response.body)
      expect(response.body.details).toEqual({
        studentName: expected.studentName, nucatRank: expected.nucatRank, allocatedBranch: expected.branch, admissionStatus: 'TEST DATA', admissionYear: 2026,
        fee: { status: 'REQUIRES_CONFIRMATION' },
      })
      // Nothing about any other dummy student leaks into the response.
      for (const other of EXPECTED.filter((e) => e !== expected)) expect(JSON.stringify(response.body)).not.toContain(other.email)
    }
    // Lookup is read-only: no record was claimed or modified.
    expect(await prisma.admissionRecord.count({ where: { studentAccountId: { not: null } } })).toBe(0)
  })

  it('a student cannot reach another record by changing request parameters, and unauthenticated / unverified requests fail', async () => {
    await importCsv()
    const [aarav, diya] = EXPECTED
    const cookie = await signUpAndLogIn(aarav.email)
    for (const extra of [`&email=${encodeURIComponent(diya.email)}`, `&studentId=x`, `&nucatReference=${diya.reference}`, `&officialEmail=${encodeURIComponent(diya.email)}`]) {
      const response = await api().get(DETAILS + extra).set('Cookie', cookie).expect(400)
      expect(response.body.code).toBe('VALIDATION_FAILED')
      expect(JSON.stringify(response.body)).not.toContain(diya.studentName)
    }
    // A header or body cannot substitute either: the backend uses the session's email only.
    const spoofed = await api().get(DETAILS).set('Cookie', cookie).set('X-Email', diya.email).send({ email: diya.email }).expect(200)
    expect(spoofed.body.details.studentName).toBe(aarav.studentName)
    // Wrong / inactive QR context.
    expect((await api().get('/api/students/me/admission-details?collegeId=nmamit&area=library').set('Cookie', cookie)).status).toBeGreaterThanOrEqual(400)
    await prisma.institutionQrCode.updateMany({ data: { isActive: false } })
    expect((await api().get(DETAILS).set('Cookie', cookie)).status).toBeGreaterThanOrEqual(400)
    await prisma.institutionQrCode.updateMany({ data: { isActive: true } })
    // No session at all.
    await api().get(DETAILS).expect(401)
    // Registered but not email-verified: cannot log in, so cannot reach the details.
    await api().post('/api/auth/register').send({ email: diya.email, password: passwordFor(diya.email) }).expect(202)
    expect((await api().post('/api/auth/login').send({ email: diya.email, password: passwordFor(diya.email) })).status).not.toBe(200)
    // A verified account whose email is not in the dataset gets no record.
    const stranger = await signUpAndLogIn('not.in.dataset@example.com')
    expect((await api().get(DETAILS).set('Cookie', stranger).expect(404)).body.code).toBe('NO_ADMISSION_RECORD')
  })

  it('fee categories: General, Scholarship and NRI are stored; with no verified fee schedule each stays "requires confirmation"', async () => {
    await importCsv()
    const counts = await prisma.admissionRecord.groupBy({ by: ['feeCategory'], _count: { _all: true }, orderBy: { feeCategory: 'asc' } })
    expect(Object.fromEntries(counts.map((c) => [c.feeCategory, c._count._all]))).toEqual({ GENERAL: 5, SCHOLARSHIP: 3, NRI: 2 })
    expect(await prisma.feeSchedule.count()).toBe(0)
    for (const category of ['GENERAL', 'SCHOLARSHIP', 'NRI']) {
      const student = EXPECTED.find((e) => e.category === category)!
      const cookie = await signUpAndLogIn(student.email)
      const details = (await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details
      expect(details.fee).toEqual({ status: 'REQUIRES_CONFIRMATION' })
    }
  })
})

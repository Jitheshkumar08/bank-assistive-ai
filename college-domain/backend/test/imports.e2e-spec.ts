import type { INestApplication } from '@nestjs/common'
import ExcelJS from 'exceljs'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { CapturingEmailSender, createTestApp, expectNoSecrets, provisionStaff, resetTestDatabase, sessionCookie } from './helpers.js'

// Synthetic TEST-ONLY admission data (invented names and references) in the disposable test database.
const HEADER = ['NUCAT Reference', 'Student Name', 'Admission Year', 'NUCAT Rank', 'Branch', 'Status', 'Email']
const csv = (rows: (string | number)[][]) => Buffer.from([HEADER, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n'))
const row = (reference: string, name: string, year: number | string, rank: number | string, branch: string, status: string, email: string) => [reference, name, year, rank, branch, status, email]

describe('College Admin: admission imports and student records (e2e)', () => {
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

  const preview = (file: Buffer, name: string, year: number | string, cookie = admin) =>
    api().post('/api/admin/admission-imports/preview').set('Cookie', cookie).field('admissionYear', String(year)).attach('file', file, name)
  const commit = (id: string, duplicatePolicy: string, cookie = admin) =>
    api().post(`/api/admin/admission-imports/${id}/commit`).set('Cookie', cookie).send({ duplicatePolicy })
  const records = (year?: number) => prisma.admissionRecord.findMany({ where: year ? { admissionYear: year } : {}, orderBy: [{ admissionYear: 'asc' }, { nucatReference: 'asc' }] })

  describe('validation and preview', () => {
    it('validates rows, flags in-file duplicates and changes nothing before confirmation', async () => {
      const file = csv([
        row('TST-001', 'Test Student One', 2025, 101, 'Fixture Branch A', 'Admitted', 'one@example.com'),
        row('tst 002', 'Test Student Two', '', '', '', 'Pending', ''),
        row('TST-003', '', 2025, 'abc', 'Fixture Branch B', 'Admitted', 'not-an-email'),
        row('TST-004', 'Test Student Four', 2024, 50, 'Fixture Branch A', 'Admitted', 'four@example.com'),
        row('TST-005', 'Test Student Five', 2025, 77, 'Fixture Branch A', 'Admitted', 'five@example.com'),
        row('TST-005', 'Test Student Five Again', 2025, 78, 'Fixture Branch A', 'Admitted', 'five@example.com'),
      ])
      const response = await preview(file, 'admissions_2025.csv', 2025).expect(201)
      expect(response.body).toMatchObject({
        fileName: 'admissions_2025.csv', admissionYear: 2025, status: 'awaiting_confirmation',
        counts: { total: 6, valid: 2, invalid: 2, duplicates: 2, new: 2, changed: 0, unchanged: 0, inserted: 0 },
      })
      expect(response.body.columns.matched.map((column: { field: string }) => column.field)).toEqual(['nucatReference', 'studentName', 'admissionYear', 'nucatRank', 'allocatedBranch', 'admissionStatus', 'officialEmail'])
      const rows = (await api().get(`/api/admin/admission-imports/${response.body.id}/rows?pageSize=50`).set('Cookie', admin).expect(200)).body.items
      const byRow = (n: number) => rows.find((item: { rowNumber: number }) => item.rowNumber === n)
      expect(byRow(3)).toMatchObject({ outcome: 'VALID', nucatReference: 'TST002', action: 'INSERT' })
      expect(byRow(3).messages).toEqual([expect.objectContaining({ level: 'warning', text: expect.stringMatching(/No email/) })])
      expect(byRow(4).outcome).toBe('INVALID')
      expect(byRow(4).messages.map((m: { text: string }) => m.text)).toEqual(expect.arrayContaining(['Missing student name.', expect.stringMatching(/rank/), 'Email address is not valid.']))
      expect(byRow(5).messages[0].text).toMatch(/2024 does not match the selected year 2025/)
      expect(byRow(6)).toMatchObject({ outcome: 'DUPLICATE_IN_FILE' })
      expect(byRow(6).messages[0].text).toMatch(/also in row 7/)
      expect(await prisma.admissionRecord.count()).toBe(0)
    })

    it('rejects files without the required columns, unsupported types and oversized files', async () => {
      const noReference = Buffer.from('Student Name,Branch\r\nTest Student,CSE\r\n')
      const missing = await preview(noReference, 'list.csv', 2025).expect(400)
      expect(missing.body).toMatchObject({ code: 'INVALID_FILE' })
      expect(missing.body.message).toMatch(/Required column "NUCAT Reference" was not found/)
      expect((await preview(Buffer.from('hello'), 'notes.txt', 2025).expect(400)).body.code).toBe('INVALID_FILE')
      expect((await preview(Buffer.from('PK\u0003\u0004 fake'), 'legacy.xls', 2025).expect(400)).body.message).toMatch(/\.xls/)
      expect((await preview(Buffer.from('not a zip'), 'fake.xlsx', 2025).expect(400)).body.code).toBe('INVALID_FILE')
      expect((await preview(Buffer.alloc(5 * 1024 * 1024 + 10, 'a'), 'big.csv', 2025).expect(413)).body.code).toBe('FILE_TOO_LARGE')
      expect((await preview(csv([]), 'empty.csv', 2025).expect(400)).body.message).toMatch(/no data rows/)
      expect((await preview(csv([row('A1-1', 'X', '', '', '', '', '')]), 'x.csv', 'twenty').expect(400)).body.code).toBe('VALIDATION_FAILED')
      expect(await prisma.admissionImportBatch.count()).toBe(0)
    })

    it('reads .xlsx workbooks (numbers, formulas and rich text)', async () => {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Admissions')
      sheet.addRow(HEADER)
      sheet.addRow([12345, 'Test Xlsx Student', 2025, { formula: '40+2', result: 42 }, 'Fixture Branch A', 'Admitted', 'xlsx@example.com'])
      sheet.addRow(['TST-X2', { richText: [{ text: 'Rich ' }, { text: 'Text Student' }] }, 2025, null, null, null, null])
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
      const response = await preview(buffer, 'admissions_2025.xlsx', 2025).expect(201)
      expect(response.body.counts).toMatchObject({ total: 2, valid: 2, invalid: 0 })
      await commit(response.body.id, 'SKIP_EXISTING').expect(200)
      expect((await records(2025)).map((r) => [r.nucatReference, r.studentName, r.nucatRank])).toEqual([['12345', 'Test Xlsx Student', 42], ['TST-X2', 'Rich Text Student', null]])
    })
  })

  describe('commit', () => {
    it('imports valid rows only, reports accurate counts, and can be committed only once', async () => {
      const file = csv([
        row('TST-101', 'Test Student A', 2025, 11, 'Fixture Branch A', 'Admitted', 'a@example.com'),
        row('TST-102', 'Test Student B', 2025, 12, 'Fixture Branch B', 'Pending', 'b@example.com'),
        row('', 'Missing Reference', 2025, 13, 'Fixture Branch A', 'Admitted', 'c@example.com'),
      ])
      const { body } = await preview(file, 'a.csv', 2025).expect(201)
      const done = await commit(body.id, 'SKIP_EXISTING').expect(200)
      expect(done.body).toMatchObject({ status: 'partial', duplicatePolicy: 'SKIP_EXISTING', counts: { inserted: 2, updated: 0, skipped: 0, rejected: 1 } })
      expect(await prisma.admissionRecord.count()).toBe(2)
      expect(await prisma.branch.count()).toBe(2)
      // Repeated and post-hoc commits are refused without side effects.
      expect((await commit(body.id, 'SKIP_EXISTING').expect(409)).body.code).toBe('IMPORT_ALREADY_PROCESSED')
      expect((await commit(body.id, 'UPDATE_EXISTING').expect(409)).body.code).toBe('IMPORT_ALREADY_PROCESSED')
      expect(await prisma.admissionRecord.count()).toBe(2)
      const history = await api().get('/api/admin/admission-imports').set('Cookie', admin).expect(200)
      expect(history.body.items[0]).toMatchObject({ id: body.id, status: 'partial', importedBy: 'Fixture College Admin', counts: { total: 3, inserted: 2, rejected: 1 } })
      const audit = await prisma.auditEvent.count({ where: { action: 'ADMISSION_RECORD_CREATED_BY_IMPORT' } })
      expect(audit).toBe(2)
    })

    it('handles two simultaneous confirmations of the same import exactly once', async () => {
      const { body } = await preview(csv([row('TST-201', 'Test Student C', 2025, 1, 'Fixture Branch A', 'Admitted', 'c@example.com')]), 'c.csv', 2025).expect(201)
      const [first, second] = await Promise.all([commit(body.id, 'SKIP_EXISTING'), commit(body.id, 'SKIP_EXISTING')])
      expect([first.status, second.status].sort()).toEqual([200, 409])
      expect(await prisma.admissionRecord.count()).toBe(1)
    })

    it('re-importing the same file creates no duplicates', async () => {
      const file = csv([row('TST-301', 'Test Student D', 2025, 5, 'Fixture Branch A', 'Admitted', 'd@example.com')])
      await commit((await preview(file, 'd.csv', 2025).expect(201)).body.id, 'SKIP_EXISTING').expect(200)
      const again = await preview(file, 'd.csv', 2025).expect(201)
      expect(again.body.counts).toMatchObject({ new: 0, unchanged: 1 })
      expect(again.body.columns.notices.join(' ')).toMatch(/already imported/)
      expect((await commit(again.body.id, 'UPDATE_EXISTING').expect(200)).body.counts).toMatchObject({ inserted: 0, updated: 0, skipped: 1 })
      expect(await prisma.admissionRecord.count()).toBe(1)
    })

    it('skips or updates existing records only as explicitly chosen, and audits the changes', async () => {
      await commit((await preview(csv([row('TST-401', 'Test Student E', 2025, 40, 'Fixture Branch A', 'Pending', 'e@example.com')]), 'e1.csv', 2025)).body.id, 'SKIP_EXISTING').expect(200)
      const changedFile = csv([row('TST-401', 'Test Student E', 2025, 39, 'Fixture Branch B', 'Admitted', '')])
      const skipped = await preview(changedFile, 'e2.csv', 2025).expect(201)
      expect(skipped.body.counts).toMatchObject({ changed: 1 })
      const changeRow = (await api().get(`/api/admin/admission-imports/${skipped.body.id}/rows?filter=changed`).set('Cookie', admin)).body.items[0]
      // Blank email in the file does not clear the stored one.
      expect(Object.keys(changeRow.changes).sort()).toEqual(['admissionStatus', 'allocatedBranch', 'nucatRank'])
      await commit(skipped.body.id, 'SKIP_EXISTING').expect(200)
      expect(await prisma.admissionRecord.findFirstOrThrow()).toMatchObject({ nucatRank: 40, admissionStatus: 'Pending', officialEmail: 'e@example.com' })

      const updated = await preview(changedFile, 'e3.csv', 2025).expect(201)
      expect((await commit(updated.body.id, 'UPDATE_EXISTING').expect(200)).body.counts).toMatchObject({ updated: 1, inserted: 0 })
      const record = await prisma.admissionRecord.findFirstOrThrow({ include: { allocatedBranch: true } })
      expect(record).toMatchObject({ nucatRank: 39, admissionStatus: 'Admitted', officialEmail: 'e@example.com' })
      expect(record.allocatedBranch!.name).toBe('Fixture Branch B')
      const change = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'ADMISSION_RECORD_UPDATED_BY_IMPORT', entityId: record.id } })
      expect(change.metadata).toMatchObject({ changes: { nucatRank: { from: 40, to: 39 }, admissionStatus: { from: 'Pending', to: 'Admitted' } } })
    })

    it('keeps every admission year in one table and never touches other years', async () => {
      await commit((await preview(csv([row('TST-501', 'Test Student F 2024', 2024, 9, 'Fixture Branch A', 'Admitted', 'f@example.com')]), 'f24.csv', 2024)).body.id, 'SKIP_EXISTING').expect(200)
      const before = await records(2024)
      const year2025 = await preview(csv([row('TST-501', 'Test Student F 2025', 2025, 3, 'Fixture Branch B', 'Pending', 'f@example.com')]), 'f25.csv', 2025).expect(201)
      expect(year2025.body.counts).toMatchObject({ new: 1, changed: 0 })
      const notes = (await api().get(`/api/admin/admission-imports/${year2025.body.id}/rows`).set('Cookie', admin)).body.items[0].messages.map((m: { text: string }) => m.text)
      expect(notes.join(' ')).toMatch(/also exists in 2024/)
      await commit(year2025.body.id, 'UPDATE_EXISTING').expect(200)
      expect(await records(2024)).toEqual(before)
      expect((await records()).map((r) => [r.admissionYear, r.nucatReference, r.studentName])).toEqual([[2024, 'TST-501', 'Test Student F 2024'], [2025, 'TST-501', 'Test Student F 2025']])
      const years = await api().get('/api/admin/admission-years').set('Cookie', admin).expect(200)
      expect(years.body.items.map((item: { admissionYear: number; records: number }) => [item.admissionYear, item.records])).toEqual([[2025, 1], [2024, 1]])
    })

    it('rolls the whole import back when records changed after the preview', async () => {
      await commit((await preview(csv([row('TST-601', 'Test Student G', 2025, 60, 'Fixture Branch A', 'Pending', 'g@example.com')]), 'g1.csv', 2025)).body.id, 'SKIP_EXISTING').expect(200)
      const pending = await preview(csv([
        row('TST-602', 'Test Student H', 2025, 61, 'Fixture Branch Z', 'Admitted', 'h@example.com'),
        row('TST-601', 'Test Student G', 2025, 59, 'Fixture Branch A', 'Admitted', 'g@example.com'),
      ]), 'g2.csv', 2025).expect(201)
      // Another admin corrects the record after the preview was made.
      const existing = await prisma.admissionRecord.findFirstOrThrow({ where: { nucatReference: 'TST-601' } })
      await api().patch(`/api/admin/student-records/${existing.id}`).set('Cookie', admin)
        .send({ expectedUpdatedAt: existing.updatedAt.toISOString(), reason: 'Correction from the admission office', admissionStatus: 'Withdrawn' }).expect(200)
      const failed = await commit(pending.body.id, 'UPDATE_EXISTING').expect(409)
      expect(failed.body.code).toBe('IMPORT_STALE')
      // Nothing from the failed batch was written: no new record, no new branch, the manual correction survives.
      expect(await prisma.admissionRecord.count({ where: { nucatReference: 'TST-602' } })).toBe(0)
      expect(await prisma.branch.count({ where: { name: 'Fixture Branch Z' } })).toBe(0)
      expect(await prisma.admissionRecord.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ admissionStatus: 'Withdrawn', nucatRank: 60 })
      const batch = (await api().get(`/api/admin/admission-imports/${pending.body.id}`).set('Cookie', admin).expect(200)).body
      expect(batch).toMatchObject({ status: 'failed', counts: { inserted: 0, updated: 0 } })
      expect(batch.failureReason).toMatch(/No records were changed/)
      await commit(pending.body.id, 'UPDATE_EXISTING').expect(409)
    })

    it('rolls back when a conflicting record was inserted after the preview (database constraint)', async () => {
      const file = csv([row('TST-701', 'Test Student I', 2025, 70, 'Fixture Branch A', 'Admitted', 'i@example.com'), row('TST-702', 'Test Student J', 2025, 71, 'Fixture Branch A', 'Admitted', 'j@example.com')])
      const first = await preview(file, 'i1.csv', 2025).expect(201)
      const second = await preview(csv([row('TST-702', 'Test Student J', 2025, 71, 'Fixture Branch A', 'Admitted', 'j@example.com')]), 'i2.csv', 2025).expect(201)
      await commit(second.body.id, 'SKIP_EXISTING').expect(200)
      expect((await commit(first.body.id, 'SKIP_EXISTING').expect(409)).body.code).toBe('IMPORT_STALE')
      expect((await records()).map((r) => r.nucatReference)).toEqual(['TST-702'])
    })

    it('cancels a preview and produces a formula-safe validation report', async () => {
      const { body } = await preview(csv([row('TST-801', '=HYPERLINK("http://example.com")', 2025, '', '', '', ''), row('', 'No Ref', 2025, '', '', '', '')]), 'k.csv', 2025).expect(201)
      const report = await api().get(`/api/admin/admission-imports/${body.id}/report.csv`).set('Cookie', admin).expect(200)
      expect(report.headers['content-type']).toMatch(/text\/csv/)
      expect(report.headers['content-disposition']).toMatch(/attachment; filename="k-validation-report.csv"/)
      expect(report.text).toContain(`"'=HYPERLINK(""http://example.com"")"`)
      expect(report.text).toContain('Missing NUCAT reference.')
      await api().post(`/api/admin/admission-imports/${body.id}/cancel`).set('Cookie', admin).expect(200)
      expect((await commit(body.id, 'SKIP_EXISTING').expect(409)).body.code).toBe('IMPORT_ALREADY_PROCESSED')
      expect(await prisma.admissionRecord.count()).toBe(0)
    })
  })

  describe('student records and access control', () => {
    async function seed() {
      await commit((await preview(csv([
        row('TST-901', 'Test Alpha', 2025, 3, 'Fixture Branch A', 'Admitted', 'alpha@example.com'),
        row('TST-902', 'Test Beta', 2025, 1, 'Fixture Branch B', 'Pending', 'beta@example.com'),
        row('TST-903', 'Test Gamma', 2025, 2, 'Fixture Branch A', 'Admitted', 'gamma@example.com'),
      ]), 's25.csv', 2025)).body.id, 'SKIP_EXISTING').expect(200)
      await commit((await preview(csv([row('TST-904', 'Test Delta', 2024, 5, 'Fixture Branch A', 'Admitted', 'delta@example.com')]), 's24.csv', 2024)).body.id, 'SKIP_EXISTING').expect(200)
    }

    it('searches, filters, sorts and pages without exposing contact details in the list', async () => {
      await seed()
      const all = await api().get('/api/admin/student-records?sort=nucatRank&order=asc').set('Cookie', admin).expect(200)
      expect(all.body.total).toBe(4)
      expect(all.body.items.map((item: { nucatReference: string }) => item.nucatReference)).toEqual(['TST-902', 'TST-903', 'TST-901', 'TST-904'])
      expect(JSON.stringify(all.body)).not.toContain('@example.com')
      expect((await api().get('/api/admin/student-records?search=gam').set('Cookie', admin)).body.items.map((i: { studentName: string }) => i.studentName)).toEqual(['Test Gamma'])
      expect((await api().get('/api/admin/student-records?search=tst-90').set('Cookie', admin)).body.total).toBe(4)
      expect((await api().get('/api/admin/student-records?admissionYear=2024').set('Cookie', admin)).body.total).toBe(1)
      expect((await api().get('/api/admin/student-records?status=pending').set('Cookie', admin)).body.total).toBe(1)
      const filters = (await api().get('/api/admin/student-records/filters').set('Cookie', admin).expect(200)).body
      expect(filters.admissionYears).toEqual([2025, 2024])
      const branchB = filters.branches.find((b: { name: string }) => b.name === 'Fixture Branch B')
      expect((await api().get(`/api/admin/student-records?branchId=${branchB.id}`).set('Cookie', admin)).body.total).toBe(1)
      const page2 = await api().get('/api/admin/student-records?pageSize=3&page=2&sort=nucatReference').set('Cookie', admin).expect(200)
      expect(page2.body.items.map((i: { nucatReference: string }) => i.nucatReference)).toEqual(['TST-904'])
      await api().get('/api/admin/student-records?sort=password').set('Cookie', admin).expect(400)
    })

    it('edits a record only with a reason and the current version, and records the history', async () => {
      await seed()
      const record = await prisma.admissionRecord.findFirstOrThrow({ where: { nucatReference: 'TST-901' } })
      const detail = (await api().get(`/api/admin/student-records/${record.id}`).set('Cookie', admin).expect(200)).body
      expect(detail).toMatchObject({ officialEmail: 'alpha@example.com', branch: { name: 'Fixture Branch A' } })
      await api().patch(`/api/admin/student-records/${record.id}`).set('Cookie', admin).send({ expectedUpdatedAt: detail.updatedAt, nucatRank: 4 }).expect(400)
      await api().patch(`/api/admin/student-records/${record.id}`).set('Cookie', admin).send({ expectedUpdatedAt: detail.updatedAt, reason: 'Rank corrected', nucatReference: 'X' }).expect(400)
      await api().patch(`/api/admin/student-records/${record.id}`).set('Cookie', admin).send({ expectedUpdatedAt: detail.updatedAt, reason: 'Rank corrected', nucatRank: -2 }).expect(400)
      const saved = await api().patch(`/api/admin/student-records/${record.id}`).set('Cookie', admin).send({ expectedUpdatedAt: detail.updatedAt, reason: 'Rank corrected by office', nucatRank: 4 }).expect(200)
      expect(saved.body.nucatRank).toBe(4)
      const stale = await api().patch(`/api/admin/student-records/${record.id}`).set('Cookie', admin).send({ expectedUpdatedAt: detail.updatedAt, reason: 'Second edit', nucatRank: 5 }).expect(409)
      expect(stale.body.code).toBe('CONFLICT')
      const history = (await api().get(`/api/admin/student-records/${record.id}/history`).set('Cookie', admin).expect(200)).body.items
      expect(history.map((event: { action: string }) => event.action)).toEqual(['ADMISSION_RECORD_EDITED', 'ADMISSION_RECORD_CREATED_BY_IMPORT'])
      expect(history[0]).toMatchObject({ actorName: 'Fixture College Admin', metadata: { reason: 'Rank corrected by office', changes: { nucatRank: { from: 3, to: 4 } } } })
    })

    it('scopes every admin endpoint to the admin’s own college', async () => {
      await seed()
      await prisma.institution.create({ data: { id: 'othercollege', name: 'Other Test College', shortName: 'OTC' } })
      const { collegeAdmin: other } = await provisionStaff(app, api, mail, { email: 'other.admin@example.com', name: 'Other Admin', password: 'other admin passphrase' }, 'othercollege')
      const record = await prisma.admissionRecord.findFirstOrThrow()
      expect((await api().get('/api/admin/student-records').set('Cookie', other).expect(200)).body.total).toBe(0)
      await api().get(`/api/admin/student-records/${record.id}`).set('Cookie', other).expect(404)
      await api().patch(`/api/admin/student-records/${record.id}`).set('Cookie', other).send({ expectedUpdatedAt: record.updatedAt.toISOString(), reason: 'Not my college', nucatRank: 1 }).expect(404)
      const batch = await prisma.admissionImportBatch.findFirstOrThrow()
      await api().get(`/api/admin/admission-imports/${batch.id}`).set('Cookie', other).expect(404)
      expect((await api().get('/api/admin/dashboard').set('Cookie', other).expect(200)).body.totals.records).toBe(0)
    })

    it('dashboard reports real totals; a student sees only their own verified result', async () => {
      await seed()
      const dashboard = (await api().get('/api/admin/dashboard').set('Cookie', admin).expect(200)).body
      expect(dashboard).toMatchObject({
        totals: { records: 4, admissionYears: 2, verifiedByStudents: 0 },
        byYear: [{ admissionYear: 2024, records: 1 }, { admissionYear: 2025, records: 3 }],
        imports: { completed: 2, partial: 0, failed: 0 },
        dataQuality: { missingEmail: 0, missingRank: 0, missingBranch: 0 },
      })
      expect(dashboard.recentActivity[0]).toMatchObject({ action: 'ADMISSION_IMPORT_COMMITTED', actorName: 'Fixture College Admin' })
      expectNoSecrets(dashboard)

      const student = { email: 'beta@example.com', password: 'fixture beta passphrase' }
      await api().post('/api/auth/register').send(student).expect(202)
      await api().post('/api/auth/verify-email').send({ token: mail.lastToken(student.email) }).expect(200)
      const cookie = sessionCookie(await api().post('/api/auth/login').send(student).expect(200))!.split(';')[0]
      await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: 'TST-901' }).expect(400)
      const own = await api().post('/api/students/me/admission-verification').set('Cookie', cookie).send({ collegeId: 'nmamit', nucatReference: ' tst-902 ' }).expect(200)
      expect(own.body.result).toMatchObject({ studentName: 'Test Beta', nucatRank: 1, allocatedBranch: 'Fixture Branch B', admissionYear: 2025 })
      await api().get('/api/admin/student-records').set('Cookie', cookie).expect(403)
      expect((await api().get('/api/admin/dashboard').set('Cookie', admin)).body.totals.verifiedByStudents).toBe(1)
    })
  })

  describe('Fee Category column', () => {
    const FEE_HEADER = [...HEADER, 'Fee Category']
    const feeCsv = (rows: (string | number)[][]) => Buffer.from([FEE_HEADER, ...rows].map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n'))
    const feeRow = (reference: string, category: string, email = `${reference.toLowerCase()}@example.com`) => [...row(reference, `Test Student ${reference}`, 2026, 120, 'Fixture Programme', 'Admitted', email), category]

    // Synthetic TEST-ONLY student whose email matches one imported row.
    const STUDENT = { email: 'fee-402@example.com', password: 'fixture student passphrase' }
    async function studentCookie() {
      await api().post('/api/auth/register').send(STUDENT).expect(202)
      await api().post('/api/auth/verify-email').send({ token: mail.lastToken(STUDENT.email) }).expect(200)
      return sessionCookie(await api().post('/api/auth/login').send(STUDENT).expect(200))!.split(';')[0]
    }
    const DETAILS = '/api/students/me/admission-details?collegeId=nmamit&area=admissions-desk'

    it('GENERAL / SCHOLARSHIP / NRI / blank / invalid: correct preview, persisted after confirmation, read by the student’s own session', async () => {
      const response = await preview(feeCsv([
        feeRow('FEE-401', 'GENERAL'), feeRow('FEE-402', 'SCHOLARSHIP'), feeRow('FEE-403', 'NRI'), feeRow('FEE-404', ''), feeRow('FEE-405', 'MANAGEMENT'),
      ]), 'fees_upper_2026.csv', 2026).expect(201)
      // Preview: one invalid row, four new; nothing written yet.
      expect(response.body).toMatchObject({ status: 'awaiting_confirmation', counts: { total: 5, valid: 4, invalid: 1, duplicates: 0, new: 4, inserted: 0 } })
      const invalid = (await api().get(`/api/admin/admission-imports/${response.body.id}/rows?filter=invalid`).set('Cookie', admin).expect(200)).body.items
      expect(invalid.map((item: { nucatReference: string }) => item.nucatReference)).toEqual(['FEE-405'])
      expect(invalid[0].messages.map((message: { text: string }) => message.text)).toContain('Fee category "MANAGEMENT" must be General, Scholarship or NRI.')
      expect(await prisma.admissionRecord.count()).toBe(0)

      // Confirm: valid rows are applied, the invalid row is rejected (existing rule → status "partial").
      expect((await commit(response.body.id, 'SKIP_EXISTING').expect(200)).body).toMatchObject({ status: 'partial', counts: { inserted: 4, rejected: 1 } })
      const stored = Object.fromEntries((await records(2026)).map((record) => [record.nucatReference, record.feeCategory]))
      expect(stored).toEqual({ 'FEE-401': 'GENERAL', 'FEE-402': 'SCHOLARSHIP', 'FEE-403': 'NRI', 'FEE-404': null })

      // The student whose verified account email matches FEE-402 gets exactly that record — nothing in the request
      // identifies them. No fee schedule is loaded, so the fee stays "requires confirmation".
      const cookie = await studentCookie()
      const details = (await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details
      expect(details).toMatchObject({ studentName: 'Test Student FEE-402', nucatRank: 120, allocatedBranch: 'Fixture Programme', admissionYear: 2026 })
      expect(details.fee).toEqual({ status: 'REQUIRES_CONFIRMATION' })
      expect(JSON.stringify(details)).not.toMatch(/FEE-40[1345]|fee-40[1345]/)
      expect((await api().get(`${DETAILS}&email=fee-401%40example.com`).set('Cookie', cookie).expect(400)).body.code).toBe('VALIDATION_FAILED')
      expect(await prisma.feeSchedule.count()).toBe(0)
    })

    it('a blank category reaches the student as "category not recorded" (fee requires confirmation)', async () => {
      await commit((await preview(feeCsv([feeRow('FEE-402', '')]), 'blank.csv', 2026)).body.id, 'SKIP_EXISTING').expect(200)
      const cookie = await studentCookie()
      const details = (await api().get(DETAILS).set('Cookie', cookie).expect(200)).body.details
      expect(details.fee).toEqual({ status: 'REQUIRES_CONFIRMATION' })
    })

    it('an invalid category never modifies anything: not on preview, not an existing record on UPDATE_EXISTING, not a file of only invalid rows', async () => {
      await commit((await preview(feeCsv([feeRow('FEE-501', 'GENERAL')]), 'i1.csv', 2026)).body.id, 'SKIP_EXISTING').expect(200)
      const before = await prisma.admissionRecord.findFirstOrThrow()
      const auditsBefore = await prisma.auditEvent.count({ where: { action: 'ADMISSION_RECORD_UPDATED_BY_IMPORT' } })

      // Same reference with an invalid category and other changed values: the whole row is rejected.
      const changed = [...row('FEE-501', 'Changed Name', 2026, 7, 'Other Programme', 'Pending', 'fee-501@example.com'), 'VIP']
      const mixed = await preview(feeCsv([changed, feeRow('FEE-502', 'NRI')]), 'i2.csv', 2026).expect(201)
      expect(mixed.body.counts).toMatchObject({ valid: 1, invalid: 1, changed: 0, new: 1 })
      await commit(mixed.body.id, 'UPDATE_EXISTING').expect(200)
      expect(await prisma.admissionRecord.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
      expect(await prisma.auditEvent.count({ where: { action: 'ADMISSION_RECORD_UPDATED_BY_IMPORT' } })).toBe(auditsBefore)
      expect((await prisma.admissionRecord.findFirstOrThrow({ where: { nucatReference: 'FEE-502' } })).feeCategory).toBe('NRI')

      // Only invalid rows: confirmation is refused and nothing changes.
      const onlyInvalid = await preview(feeCsv([feeRow('FEE-503', 'GM')]), 'i3.csv', 2026).expect(201)
      expect(onlyInvalid.body.counts).toMatchObject({ valid: 0, invalid: 1 })
      expect((await commit(onlyInvalid.body.id, 'UPDATE_EXISTING').expect(400)).body.code).toBe('VALIDATION_FAILED')
      expect(await prisma.admissionRecord.count()).toBe(2)
    })

    it('files without the Fee Category column import as before: new records get no category, existing categories are kept', async () => {
      await commit((await preview(feeCsv([feeRow('FEE-601', 'SCHOLARSHIP')]), 'j1.csv', 2026)).body.id, 'SKIP_EXISTING').expect(200)
      const plain = await preview(csv([
        row('FEE-601', 'Test Student FEE-601', 2026, 99, 'Fixture Programme', 'Admitted', 'fee-601@example.com'),
        row('FEE-602', 'Test Student FEE-602', 2026, 98, 'Fixture Programme', 'Admitted', 'fee-602@example.com'),
      ]), 'j2.csv', 2026).expect(201)
      expect(plain.body.columns.matched.map((column: { field: string }) => column.field)).not.toContain('feeCategory')
      expect(plain.body.counts).toMatchObject({ valid: 2, invalid: 0, new: 1, changed: 1 })
      await commit(plain.body.id, 'UPDATE_EXISTING').expect(200)
      expect(await prisma.admissionRecord.findFirstOrThrow({ where: { nucatReference: 'FEE-601' } })).toMatchObject({ nucatRank: 99, feeCategory: 'SCHOLARSHIP' })
      expect((await prisma.admissionRecord.findFirstOrThrow({ where: { nucatReference: 'FEE-602' } })).feeCategory).toBeNull()
    })

    it('maps the column, stores General / Scholarship / NRI, leaves blanks empty and rejects unknown values', async () => {
      const response = await preview(feeCsv([
        feeRow('FEE-001', 'General'), feeRow('FEE-002', 'Scholarship Category'), feeRow('FEE-003', 'nri'), feeRow('FEE-004', ''), feeRow('FEE-005', 'GM'),
      ]), 'fees_2026.csv', 2026).expect(201)
      expect(response.body.columns.matched.map((column: { field: string }) => column.field)).toContain('feeCategory')
      expect(response.body.counts).toMatchObject({ total: 5, valid: 4, invalid: 1, new: 4 })
      const rows = (await api().get(`/api/admin/admission-imports/${response.body.id}/rows?filter=invalid`).set('Cookie', admin).expect(200)).body.items
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ rowNumber: 6, outcome: 'INVALID' })
      expect(rows[0].messages.map((message: { text: string }) => message.text).join(' ')).toContain('Fee category "GM" must be General, Scholarship or NRI.')
      expect(await prisma.admissionRecord.count()).toBe(0)

      expect((await commit(response.body.id, 'SKIP_EXISTING').expect(200)).body.counts).toMatchObject({ inserted: 4, rejected: 1 })
      const stored = Object.fromEntries((await records(2026)).map((record) => [record.nucatReference, record.feeCategory]))
      expect(stored).toEqual({ 'FEE-001': 'GENERAL', 'FEE-002': 'SCHOLARSHIP', 'FEE-003': 'NRI', 'FEE-004': null })
    })

    it('a plain "Category" header is ignored (it may mean a reservation category), never read as a fee category', async () => {
      const file = Buffer.from([[...HEADER, 'Category'], [...row('FEE-101', 'Test Student FEE-101', 2026, 5, 'Fixture Programme', 'Admitted', 'fee-101@example.com'), 'GM']]
        .map((cells) => cells.map((cell) => `"${cell}"`).join(',')).join('\r\n'))
      const response = await preview(file, 'category.csv', 2026).expect(201)
      expect(response.body.columns.matched.map((column: { field: string }) => column.field)).not.toContain('feeCategory')
      expect(response.body.columns.ignored).toContain('Category')
      await commit(response.body.id, 'SKIP_EXISTING').expect(200)
      expect((await prisma.admissionRecord.findFirstOrThrow()).feeCategory).toBeNull()
    })

    it('changes a category only with UPDATE_EXISTING, never clears it with a blank cell, and audits the change', async () => {
      await commit((await preview(feeCsv([feeRow('FEE-201', 'General')]), 'g1.csv', 2026)).body.id, 'SKIP_EXISTING').expect(200)
      const nri = await preview(feeCsv([feeRow('FEE-201', 'NRI')]), 'g2.csv', 2026).expect(201)
      expect(nri.body.counts).toMatchObject({ changed: 1 })
      const changeRow = (await api().get(`/api/admin/admission-imports/${nri.body.id}/rows?filter=changed`).set('Cookie', admin)).body.items[0]
      expect(changeRow.changes).toEqual({ feeCategory: { from: 'GENERAL', to: 'NRI' } })
      await commit(nri.body.id, 'SKIP_EXISTING').expect(200)
      expect((await prisma.admissionRecord.findFirstOrThrow()).feeCategory).toBe('GENERAL')

      await commit((await preview(feeCsv([feeRow('FEE-201', 'NRI')]), 'g3.csv', 2026)).body.id, 'UPDATE_EXISTING').expect(200)
      const record = await prisma.admissionRecord.findFirstOrThrow()
      expect(record.feeCategory).toBe('NRI')
      const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'ADMISSION_RECORD_UPDATED_BY_IMPORT', entityId: record.id } })
      expect(audit.metadata).toMatchObject({ changes: { feeCategory: { from: 'GENERAL', to: 'NRI' } } })

      const blank = await preview(feeCsv([feeRow('FEE-201', '')]), 'g4.csv', 2026).expect(201)
      expect(blank.body.counts).toMatchObject({ changed: 0, unchanged: 1 })
      await commit(blank.body.id, 'UPDATE_EXISTING').expect(200)
      expect((await prisma.admissionRecord.findFirstOrThrow()).feeCategory).toBe('NRI')
    })

    it('the imported category is what the fee service uses (synthetic fixture amounts, not official ones)', async () => {
      await commit((await preview(feeCsv([feeRow('FEE-301', 'Scholarship'), feeRow('FEE-302', '')]), 'h.csv', 2026)).body.id, 'SKIP_EXISTING').expect(200)
      const { normalizeProgramName } = await import('../src/fees/fee-calculation.js')
      const { FeeService } = await import('../src/fees/fee.service.js')
      for (const [category, annualTuition] of [['GENERAL', 2000], ['SCHOLARSHIP', 1000]] as const) {
        await prisma.feeSchedule.create({ data: {
          institutionId: 'nmamit', admissionYear: 2026, academicYear: '2026-27', programName: 'Fixture Programme', programKey: normalizeProgramName('Fixture Programme'),
          category, annualTuition, annualExamFee: 100, sourceUrl: 'https://example.com/fixture-fees.pdf', sourceSha256: 'f'.repeat(64),
        } })
      }
      const feeFor = async (reference: string) => {
        const record = await prisma.admissionRecord.findFirstOrThrow({ where: { nucatReference: reference }, include: { allocatedBranch: true } })
        return app.get(FeeService).feeFor({ institutionId: 'nmamit', admissionYear: 2026, branchName: record.allocatedBranch?.name ?? null, feeCategory: record.feeCategory })
      }
      expect(await feeFor('FEE-301')).toMatchObject({ status: 'CONFIRMED', category: 'SCHOLARSHIP', tuitionFee: 1000, examFee: 100, totalAnnualFee: 1100 })
      expect(await feeFor('FEE-302')).toEqual({ status: 'REQUIRES_CONFIRMATION', reason: 'CATEGORY_NOT_RECORDED' })
    })

    it('lists the column as optional and includes it in the CSV template', async () => {
      const columns = (await api().get('/api/admin/admission-imports/columns').set('Cookie', admin).expect(200)).body.columns
      expect(columns.find((column: { field: string }) => column.field === 'feeCategory')).toMatchObject({ label: 'Fee Category', required: false, aliases: ['Fee Category', 'Fee Type'] })
      const template = (await api().get('/api/admin/admission-imports/template.csv').set('Cookie', admin).expect(200)).text
      expect(template.trim().split(',')).toContain('Fee Category')
    })
  })
})

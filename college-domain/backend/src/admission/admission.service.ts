import { HttpStatus, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { normalizeEmail } from '../auth/tokens.js'
import type { AuthenticatedStudent } from '../auth/session.service.js'
import { ApiError } from '../common/api-error.js'
import { ContextService } from '../context/context.service.js'
import { toStudentFee } from '../fees/fee-calculation.js'
import { FeeService } from '../fees/fee.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { AdmissionDetailsDto, AdmissionResultDto } from './admission.dto.js'

/** Official references are compared trimmed, upper-cased and without internal spaces. */
export const normalizeReference = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')

const resultSelect = {
  studentName: true, nucatRank: true, admissionStatus: true, verifiedAt: true, admissionYear: true,
  allocatedBranch: { select: { name: true } },
} as const

const notVerified = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_VERIFIED', 'Verify your NUCAT reference number to view your admission result.')
// Same answer for "no such reference", "belongs to another email" and "already claimed": nothing about other students leaks.
const mismatch = () => new ApiError(HttpStatus.BAD_REQUEST, 'REFERENCE_MISMATCH', 'This NUCAT reference number does not match an admission record for your account. Check it and try again, or contact the admission office.')

// Neither answer says anything about other students' records.
const noRecord = () => new ApiError(HttpStatus.NOT_FOUND, 'NO_ADMISSION_RECORD', 'No admission record matches the email address of your CampusGuide account. If you applied with a different email, contact the admission office.')
const ambiguous = () => new ApiError(HttpStatus.CONFLICT, 'AMBIGUOUS_ADMISSION_RECORD', 'More than one admission record matches your account, so none can be shown. Please contact the admission office.')

type Row = { studentName: string; nucatRank: number | null; admissionStatus: string | null; verifiedAt: Date | null; admissionYear: number; allocatedBranch: { name: string } | null }

const toResult = (row: Row): AdmissionResultDto => ({
  studentName: row.studentName,
  nucatRank: row.nucatRank,
  allocatedBranch: row.allocatedBranch?.name ?? null,
  admissionStatus: row.admissionStatus,
  admissionYear: row.admissionYear,
  verifiedAt: (row.verifiedAt ?? new Date()).toISOString(),
})

/**
 * Admission verification (kept separate from auth and QR handling).
 * Identity = the session; the QR only selects the college; the reference number must belong to an official record whose
 * official email equals the signed-in account's verified email. Results come only from imported official records.
 */
@Injectable()
export class AdmissionService {
  constructor(private readonly prisma: PrismaService, private readonly context: ContextService, private readonly audit: AuditService, private readonly fees: FeeService) {}

  /**
   * QR flow: after the scanned context is re-checked, the record is found by the session account's email — never by
   * anything the browser sends. Newest admission year wins; two records for that email in the same year are ambiguous.
   * Read-only: it does not claim or change the record.
   */
  async getDetails(student: AuthenticatedStudent, collegeId: string, area: string | null): Promise<{ details: AdmissionDetailsDto }> {
    await this.context.requireActiveContext(collegeId, area)
    const email = normalizeEmail(student.email)
    const candidates = await this.prisma.admissionRecord.findMany({
      // A record already verified by a different account (through the NUCAT reference flow) is never shown here.
      where: { institutionId: collegeId, officialEmail: { equals: email, mode: 'insensitive' }, OR: [{ studentAccountId: null }, { studentAccountId: student.id }] },
      select: { ...resultSelect, feeCategory: true },
      orderBy: { admissionYear: 'desc' },
      take: 20,
    })
    if (candidates.length === 0) throw noRecord()
    const newest = candidates.filter((candidate) => candidate.admissionYear === candidates[0].admissionYear)
    if (newest.length > 1) {
      await this.audit.record({ actorType: 'STUDENT', actorId: student.id, action: 'ADMISSION_DETAILS_AMBIGUOUS', entityType: 'Institution', entityId: collegeId, metadata: { admissionYear: newest[0].admissionYear, matches: newest.length } })
      throw ambiguous()
    }
    const [row] = newest
    const branchName = row.allocatedBranch?.name ?? null
    // Every input comes from the matched official record; only the final amount (or "requires confirmation") leaves here.
    const fee = toStudentFee(await this.fees.feeFor({ institutionId: collegeId, admissionYear: row.admissionYear, branchName, feeCategory: row.feeCategory }))
    return {
      details: { studentName: row.studentName, nucatRank: row.nucatRank, allocatedBranch: branchName, admissionStatus: row.admissionStatus, admissionYear: row.admissionYear, fee },
    }
  }

  async getResult(student: AuthenticatedStudent, collegeId: string) {
    await this.context.requireActiveInstitution(collegeId)
    const row = await this.prisma.admissionRecord.findFirst({ where: { institutionId: collegeId, studentAccountId: student.id }, select: resultSelect })
    if (!row) throw notVerified()
    return { result: toResult(row) }
  }

  async verify(student: AuthenticatedStudent, collegeId: string, rawReference: string) {
    await this.context.requireActiveInstitution(collegeId)
    const nucatReference = normalizeReference(rawReference)
    // A reference may exist in several admission years (records are year-scoped); take the newest one that belongs to
    // this account's verified email and is not claimed by someone else.
    const candidates = await this.prisma.admissionRecord.findMany({
      where: { institutionId: collegeId, nucatReference },
      select: { id: true, officialEmail: true, studentAccountId: true },
      orderBy: { admissionYear: 'desc' },
    })
    const email = normalizeEmail(student.email)
    const record = candidates.find((candidate) => Boolean(candidate.officialEmail) && normalizeEmail(candidate.officialEmail!) === email
      && (!candidate.studentAccountId || candidate.studentAccountId === student.id))
    if (!record) {
      await this.audit.record({ actorType: 'STUDENT', actorId: student.id, action: 'ADMISSION_VERIFICATION_FAILED', entityType: 'Institution', entityId: collegeId })
      throw mismatch()
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (!record.studentAccountId) {
        const linked = await tx.admissionRecord.updateMany({ where: { id: record.id, studentAccountId: null }, data: { studentAccountId: student.id, verifiedAt: new Date() } })
        if (linked.count !== 1) throw mismatch()
        await this.audit.record({ actorType: 'STUDENT', actorId: student.id, action: 'ADMISSION_RECORD_VERIFIED', entityType: 'AdmissionRecord', entityId: record.id }, tx)
      }
      return tx.admissionRecord.findUniqueOrThrow({ where: { id: record.id }, select: resultSelect })
    })
    return { result: toResult(row) }
  }
}

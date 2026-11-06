import { Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import type { FeeCategory } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { calculateFee, normalizeProgramName, unconfirmed, type FeeDetails } from './fee-calculation.js'
import type { FeeScheduleRowInput } from './fee-schedule-file.js'

/** Looks up and loads official fee schedules. Knows nothing about QR codes or sessions. */
@Injectable()
export class FeeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async feeFor(record: { institutionId: string; admissionYear: number; branchName: string | null; feeCategory: FeeCategory | null }): Promise<FeeDetails> {
    if (!record.branchName) return unconfirmed('BRANCH_NOT_ALLOCATED')
    if (!record.feeCategory) return unconfirmed('CATEGORY_NOT_RECORDED')
    const key = normalizeProgramName(record.branchName)
    const matches = await this.prisma.feeSchedule.findMany({
      where: { institutionId: record.institutionId, admissionYear: record.admissionYear, category: record.feeCategory, OR: [{ programKey: key }, { aliasKeys: { has: key } }] },
      select: { academicYear: true, programName: true, category: true, annualTuition: true, annualExamFee: true, sourceUrl: true },
      take: 2,
    })
    return calculateFee(record, matches)
  }

  /** Inserts or updates the confirmed rows of one schedule file in a single transaction; never deletes rows. */
  async load(rows: FeeScheduleRowInput[]) {
    const [first] = rows
    const institution = await this.prisma.institution.findUnique({ where: { id: first.institutionId }, select: { id: true } })
    if (!institution) throw new Error(`Institution "${first.institutionId}" does not exist.`)
    return this.prisma.$transaction(async (tx) => {
      let created = 0
      let updated = 0
      for (const row of rows) {
        const key = { institutionId_admissionYear_programKey_category: { institutionId: row.institutionId, admissionYear: row.admissionYear, programKey: row.programKey, category: row.category } }
        const existing = await tx.feeSchedule.findUnique({ where: key, select: { id: true } })
        await tx.feeSchedule.upsert({ where: key, create: row, update: row })
        if (existing) updated += 1
        else created += 1
      }
      await this.audit.record({
        actorType: 'SYSTEM', action: 'FEE_SCHEDULE_LOADED', entityType: 'FeeSchedule', entityId: first.institutionId,
        metadata: { admissionYear: first.admissionYear, academicYear: first.academicYear, sourceUrl: first.sourceUrl, sourceSha256: first.sourceSha256, created, updated },
      }, tx)
      return { created, updated }
    })
  }
}

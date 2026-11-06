import { Injectable } from '@nestjs/common'
import { presentAuditEvents } from '../audit/audit-view.js'
import { requireInstitution } from '../auth/roles.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { publicStatus } from './imports/admission-import.service.js'

/** Dashboard statistics computed from the college's actual records and imports (nothing is estimated). */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(account: AuthenticatedAccount) {
    const institutionId = requireInstitution(account)
    const records = { institutionId }
    const [institution, total, byYear, missingEmail, missingRank, missingBranch, verified, statusGroups, latest, recentImports] = await Promise.all([
      this.prisma.institution.findUnique({ where: { id: institutionId }, select: { id: true, name: true, shortName: true } }),
      this.prisma.admissionRecord.count({ where: records }),
      this.prisma.admissionRecord.groupBy({ by: ['admissionYear'], where: records, _count: { _all: true }, orderBy: { admissionYear: 'asc' } }),
      this.prisma.admissionRecord.count({ where: { ...records, officialEmail: null } }),
      this.prisma.admissionRecord.count({ where: { ...records, nucatRank: null } }),
      this.prisma.admissionRecord.count({ where: { ...records, allocatedBranchId: null } }),
      this.prisma.admissionRecord.count({ where: { ...records, studentAccountId: { not: null } } }),
      this.prisma.admissionImportBatch.groupBy({ by: ['status'], where: { institutionId }, _count: { _all: true } }),
      this.prisma.admissionImportBatch.findFirst({
        where: { institutionId, status: { in: ['APPLIED', 'PARTIAL', 'FAILED'] } }, orderBy: { createdAt: 'desc' },
        select: { id: true, sourceFileName: true, admissionYear: true, status: true, createdAt: true, rowCount: true, createdCount: true, updatedCount: true, rejectedCount: true, previewExpiresAt: true },
      }),
      this.prisma.admissionImportBatch.findMany({
        where: { institutionId, status: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, sourceFileName: true, admissionYear: true, status: true, createdAt: true, rowCount: true, previewExpiresAt: true },
      }),
    ])
    const countOf = (...statuses: string[]) => statusGroups.filter((group) => statuses.includes(group.status)).reduce((sum, group) => sum + group._count._all, 0)
    // Activity of this college's admins only.
    const staffIds = (await this.prisma.studentAccount.findMany({ where: { role: 'COLLEGE_ADMIN', institutionId }, select: { id: true } })).map((staff) => staff.id)
    const activity = await this.prisma.auditEvent.findMany({
      where: { actorType: 'ADMIN', actorId: { in: staffIds }, action: { in: ['ADMISSION_IMPORT_COMMITTED', 'ADMISSION_IMPORT_FAILED', 'ADMISSION_IMPORT_CANCELLED', 'ADMISSION_IMPORT_PREVIEWED', 'ADMISSION_RECORD_EDITED'] } },
      orderBy: { createdAt: 'desc' }, take: 8,
    })
    return {
      college: institution,
      totals: { records: total, verifiedByStudents: verified, admissionYears: byYear.length },
      byYear: byYear.map((row) => ({ admissionYear: row.admissionYear, records: row._count._all })),
      imports: {
        completed: countOf('APPLIED'), partial: countOf('PARTIAL'), failed: countOf('FAILED'), awaitingConfirmation: countOf('VALIDATED'),
        latest: latest ? {
          id: latest.id, fileName: latest.sourceFileName, admissionYear: latest.admissionYear, status: publicStatus(latest.status, latest.previewExpiresAt),
          createdAt: latest.createdAt.toISOString(), rows: latest.rowCount, inserted: latest.createdCount, updated: latest.updatedCount, rejected: latest.rejectedCount,
        } : null,
        recent: recentImports.map((batch) => ({
          id: batch.id, fileName: batch.sourceFileName, admissionYear: batch.admissionYear, status: publicStatus(batch.status, batch.previewExpiresAt),
          createdAt: batch.createdAt.toISOString(), rows: batch.rowCount,
        })),
      },
      dataQuality: { missingEmail, missingRank, missingBranch, rejectedRowsInLatestImport: latest?.rejectedCount ?? 0 },
      recentActivity: await presentAuditEvents(this.prisma, activity),
    }
  }
}

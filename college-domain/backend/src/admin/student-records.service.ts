import { HttpStatus, Injectable } from '@nestjs/common'
import { normalizeReference } from '../admission/admission.service.js'
import { presentAuditEvents } from '../audit/audit-view.js'
import { AuditService } from '../audit/audit.service.js'
import { actorTypeFor, requireInstitution } from '../auth/roles.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ApiError } from '../common/api-error.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { StudentRecordQueryDto, UpdateStudentRecordDto } from './admin.dto.js'

const listSelect = {
  id: true, nucatReference: true, studentName: true, admissionYear: true, nucatRank: true, admissionStatus: true, updatedAt: true,
  studentAccountId: true, allocatedBranch: { select: { id: true, name: true } },
} as const satisfies Prisma.AdmissionRecordSelect

/**
 * College Admin view of official admission records, always scoped to the admin's own college. The list omits contact
 * details (least privilege); the detail view adds the official email needed to support verification.
 */
@Injectable()
export class StudentRecordsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(account: AuthenticatedAccount, query: StudentRecordQueryDto) {
    const institutionId = requireInstitution(account)
    const search = query.search?.trim()
    const where: Prisma.AdmissionRecordWhereInput = {
      institutionId,
      ...(query.admissionYear ? { admissionYear: query.admissionYear } : {}),
      ...(query.branchId ? { allocatedBranchId: query.branchId } : {}),
      ...(query.status ? { admissionStatus: { equals: query.status, mode: 'insensitive' } } : {}),
      ...(search ? { OR: [{ studentName: { contains: search, mode: 'insensitive' } }, { nucatReference: { startsWith: normalizeReference(search) } }] } : {}),
    }
    const orderBy: Prisma.AdmissionRecordOrderByWithRelationInput[] = [
      query.sort === 'nucatRank' ? { nucatRank: { sort: query.order, nulls: 'last' } } : query.sort === 'admissionStatus' ? { admissionStatus: { sort: query.order, nulls: 'last' } } : { [query.sort]: query.order },
      { nucatReference: 'asc' }, { admissionYear: 'desc' },
    ]
    const [total, records] = await Promise.all([
      this.prisma.admissionRecord.count({ where }),
      this.prisma.admissionRecord.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: listSelect }),
    ])
    return {
      items: records.map((record) => ({
        id: record.id, nucatReference: record.nucatReference, studentName: record.studentName, admissionYear: record.admissionYear,
        nucatRank: record.nucatRank, branch: record.allocatedBranch, admissionStatus: record.admissionStatus,
        verifiedByStudent: Boolean(record.studentAccountId), updatedAt: record.updatedAt.toISOString(),
      })),
      total, page: query.page, pageSize: query.pageSize,
    }
  }

  /** Values for the filter controls, from this college's actual data. */
  async filters(account: AuthenticatedAccount) {
    const institutionId = requireInstitution(account)
    const [years, branches, statuses] = await Promise.all([
      this.prisma.admissionRecord.groupBy({ by: ['admissionYear'], where: { institutionId }, _count: { _all: true }, orderBy: { admissionYear: 'desc' } }),
      this.prisma.branch.findMany({ where: { institutionId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.admissionRecord.groupBy({ by: ['admissionStatus'], where: { institutionId, admissionStatus: { not: null } }, orderBy: { admissionStatus: 'asc' } }),
    ])
    return {
      admissionYears: years.map((year) => year.admissionYear),
      branches,
      statuses: statuses.map((status) => status.admissionStatus!).filter(Boolean),
    }
  }

  async get(account: AuthenticatedAccount, id: string) {
    const institutionId = requireInstitution(account)
    const record = await this.prisma.admissionRecord.findFirst({
      where: { id, institutionId },
      select: {
        ...listSelect, officialEmail: true, verifiedAt: true, createdAt: true,
        lastImportBatch: { select: { id: true, sourceFileName: true, createdAt: true } },
      },
    })
    if (!record) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Admission record not found.')
    return {
      id: record.id, nucatReference: record.nucatReference, studentName: record.studentName, admissionYear: record.admissionYear,
      nucatRank: record.nucatRank, branch: record.allocatedBranch, admissionStatus: record.admissionStatus, officialEmail: record.officialEmail,
      verifiedByStudent: Boolean(record.studentAccountId), verifiedAt: record.verifiedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
      lastImport: record.lastImportBatch ? { id: record.lastImportBatch.id, fileName: record.lastImportBatch.sourceFileName, createdAt: record.lastImportBatch.createdAt.toISOString() } : null,
    }
  }

  /** Corrects official fields after an explicit confirmation in the UI. Refused if the record changed since it was loaded. */
  async update(account: AuthenticatedAccount, id: string, input: UpdateStudentRecordDto) {
    const institutionId = requireInstitution(account)
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.admissionRecord.findFirst({
        where: { id, institutionId },
        select: { studentName: true, nucatRank: true, admissionStatus: true, officialEmail: true, updatedAt: true, allocatedBranch: { select: { id: true, name: true } } },
      })
      if (!current) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Admission record not found.')
      if (current.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'This record was changed by someone else after you opened it. Reload it and try again.')
      }
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      const data: Prisma.AdmissionRecordUncheckedUpdateInput = {}
      if (input.studentName !== undefined && input.studentName !== current.studentName) { changes.studentName = { from: current.studentName, to: input.studentName }; data.studentName = input.studentName }
      if (input.nucatRank !== undefined && input.nucatRank !== current.nucatRank) { changes.nucatRank = { from: current.nucatRank, to: input.nucatRank }; data.nucatRank = input.nucatRank }
      if (input.admissionStatus !== undefined && input.admissionStatus !== current.admissionStatus) { changes.admissionStatus = { from: current.admissionStatus, to: input.admissionStatus }; data.admissionStatus = input.admissionStatus }
      if (input.officialEmail !== undefined && input.officialEmail !== current.officialEmail) { changes.officialEmail = { from: current.officialEmail, to: input.officialEmail }; data.officialEmail = input.officialEmail }
      if (input.allocatedBranchId !== undefined && input.allocatedBranchId !== (current.allocatedBranch?.id ?? null)) {
        const branch = input.allocatedBranchId ? await tx.branch.findFirst({ where: { id: input.allocatedBranchId, institutionId }, select: { name: true } }) : null
        if (input.allocatedBranchId && !branch) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Choose a branch of this college.', [{ field: 'allocatedBranchId', messages: ['Choose a branch of this college.'] }])
        changes.allocatedBranch = { from: current.allocatedBranch?.name ?? null, to: branch?.name ?? null }
        data.allocatedBranchId = input.allocatedBranchId
      }
      if (!Object.keys(changes).length) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Nothing was changed.')
      // Optimistic concurrency: the WHERE includes the updatedAt the admin saw.
      const updated = await tx.admissionRecord.updateMany({ where: { id, institutionId, updatedAt: current.updatedAt }, data })
      if (updated.count !== 1) throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'This record was changed by someone else after you opened it. Reload it and try again.')
      await this.audit.record({
        actorType: actorTypeFor(account.role), actorId: account.id, action: 'ADMISSION_RECORD_EDITED', entityType: 'AdmissionRecord', entityId: id,
        metadata: { reason: input.reason, changes } as Prisma.InputJsonValue,
      }, tx)
    })
    return this.get(account, id)
  }

  async history(account: AuthenticatedAccount, id: string) {
    const institutionId = requireInstitution(account)
    if (!await this.prisma.admissionRecord.findFirst({ where: { id, institutionId }, select: { id: true } })) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Admission record not found.')
    }
    const events = await this.prisma.auditEvent.findMany({ where: { entityType: 'AdmissionRecord', entityId: id }, orderBy: { createdAt: 'desc' }, take: 100 })
    return { items: await presentAuditEvents(this.prisma, events) }
  }

  /** Admission years present in the shared table, with record counts and their latest import. */
  async years(account: AuthenticatedAccount) {
    const institutionId = requireInstitution(account)
    const [records, verified, imports] = await Promise.all([
      this.prisma.admissionRecord.groupBy({ by: ['admissionYear'], where: { institutionId }, _count: { _all: true } }),
      this.prisma.admissionRecord.groupBy({ by: ['admissionYear'], where: { institutionId, studentAccountId: { not: null } }, _count: { _all: true } }),
      this.prisma.admissionImportBatch.findMany({
        where: { institutionId, status: { in: ['APPLIED', 'PARTIAL', 'FAILED'] } }, orderBy: { createdAt: 'desc' },
        select: { admissionYear: true, createdAt: true, status: true, sourceFileName: true, id: true },
      }),
    ])
    const allYears = new Set([...records.map((row) => row.admissionYear), ...imports.map((batch) => batch.admissionYear)])
    return {
      items: [...allYears].sort((a, b) => b - a).map((year) => {
        const latest = imports.find((batch) => batch.admissionYear === year)
        return {
          admissionYear: year,
          records: records.find((row) => row.admissionYear === year)?._count._all ?? 0,
          verifiedByStudents: verified.find((row) => row.admissionYear === year)?._count._all ?? 0,
          imports: imports.filter((batch) => batch.admissionYear === year).length,
          latestImport: latest ? { id: latest.id, fileName: latest.sourceFileName, createdAt: latest.createdAt.toISOString(), status: latest.status === 'APPLIED' ? 'completed' : latest.status.toLowerCase() } : null,
        }
      }),
    }
  }
}

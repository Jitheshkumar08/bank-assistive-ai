import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { AuditService } from '../../audit/audit.service.js'
import { actorTypeFor, requireInstitution } from '../../auth/roles.js'
import type { AuthenticatedAccount } from '../../auth/session.service.js'
import { ApiError } from '../../common/api-error.js'
import { AppConfig } from '../../config/app-config.service.js'
import { Prisma, type FeeCategory, type ImportBatchStatus, type ImportDuplicatePolicy, type ImportRowOutcome } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { IMPORT_COLUMNS, resolveColumns, type ImportField } from './import-columns.js'
import { checkRow, diffRecord, type CheckedRow, type FieldChanges, type RowMessage, type RowValues } from './row-validator.js'
import { parseSpreadsheet } from './spreadsheet-parser.js'

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000
const CHUNK = 1000

type Tx = Prisma.TransactionClient
type StoredRow = { rowNumber: number; outcome: ImportRowOutcome; action: 'INSERT' | 'UPDATE' | 'UNCHANGED' | null; nucatReference: string | null; data: RowValues; changes: FieldChanges | null; messages: RowMessage[]; existingRecordId: string | null }
type ColumnInfo = { matched: { header: string; field: string; label: string }[]; ignored: string[]; notices: string[] }

export type RowFilter = 'all' | 'issues' | 'valid' | 'invalid' | 'duplicate' | 'new' | 'changed' | 'unchanged'

/** Statuses as shown in the UI. VALIDATED past its expiry is reported as "expired". */
export function publicStatus(status: ImportBatchStatus, previewExpiresAt: Date | null, now = new Date()) {
  if (status === 'VALIDATED') return previewExpiresAt && previewExpiresAt <= now ? 'expired' : 'awaiting_confirmation'
  return ({ PENDING: 'pending', PROCESSING: 'processing', APPLIED: 'completed', PARTIAL: 'partial', FAILED: 'failed', CANCELLED: 'cancelled' } as const)[status]
}

const chunks = <T>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
const branchCode = (name: string) => `B-${createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 10).toUpperCase()}`

/**
 * Official admission imports: parse → validate → preview (stored, nothing official changes) → explicit commit with a
 * chosen duplicate policy, in ONE transaction. Every admission year shares the AdmissionRecord table; an import only
 * touches rows of its own year, so earlier years are never deleted or modified.
 */
@Injectable()
export class AdmissionImportService {
  private readonly logger = new Logger('AdmissionImport')

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly config: AppConfig) {}

  columns() {
    return {
      columns: IMPORT_COLUMNS.map(({ field, label, required, description, aliases }) => ({
        field, label, required, description, aliases: [...aliases, ...(this.config.env.ADMISSION_IMPORT_COLUMN_ALIASES[field] ?? [])],
      })),
      limits: { maxBytes: 5 * 1024 * 1024, maxRows: 10_000, fileTypes: ['.xlsx', '.csv'] },
      rules: [
        'The first non-empty row must contain the column headers.',
        'Rows are matched to existing records by NUCAT reference within the selected admission year only.',
        'Blank optional cells never clear values already stored.',
        'A reference that appears more than once in the file is rejected — fix the file and upload it again.',
      ],
    }
  }

  templateCsv() {
    return `${IMPORT_COLUMNS.map((column) => column.label).join(',')}\r\n`
  }

  async preview(account: AuthenticatedAccount, file: { originalname: string; buffer: Buffer } | undefined, admissionYear: number) {
    const institutionId = requireInstitution(account)
    if (!file) throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_FILE', 'Choose an .xlsx or .csv file to upload.')
    const fileName = (file.originalname.split(/[\\/]/).pop() ?? 'upload').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 200) || 'upload'
    const sheet = await parseSpreadsheet(fileName, file.buffer)

    const columns = resolveColumns(sheet.headers, this.config.env.ADMISSION_IMPORT_COLUMN_ALIASES)
    if (columns.missing.length || columns.conflicts.length) {
      const problems = [
        ...columns.missing.map((column) => `Required column "${column.label}" was not found.`),
        ...columns.conflicts,
      ]
      throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_FILE', `${problems.join(' ')} Headers found: ${sheet.headers.filter(Boolean).slice(0, 20).join(', ') || 'none'}.`,
        [{ field: 'file', messages: problems }])
    }

    const checked: CheckedRow[] = sheet.rows.map((row) => {
      const cells: Partial<Record<ImportField, string>> = {}
      for (const [index, field] of columns.byIndex) cells[field] = row.cells[index] ?? ''
      return checkRow(row.rowNumber, cells, admissionYear)
    })

    // Duplicates inside the file: every occurrence is rejected — choosing one would be a guess.
    const occurrences = new Map<string, number[]>()
    for (const row of checked) {
      if (row.values.nucatReference) occurrences.set(row.values.nucatReference, [...(occurrences.get(row.values.nucatReference) ?? []), row.rowNumber])
    }

    const references = [...new Set(checked.filter((row) => row.valid && row.values.nucatReference).map((row) => row.values.nucatReference!))]
    const existing = new Map<string, { id: string; studentName: string; nucatRank: number | null; admissionStatus: string | null; officialEmail: string | null; feeCategory: FeeCategory | null; allocatedBranch: { name: string } | null }>()
    const otherYears = new Map<string, number[]>()
    for (const part of chunks(references)) {
      const [sameYear, elsewhere] = await Promise.all([
        this.prisma.admissionRecord.findMany({
          where: { institutionId, admissionYear, nucatReference: { in: part } },
          select: { id: true, nucatReference: true, studentName: true, nucatRank: true, admissionStatus: true, officialEmail: true, feeCategory: true, allocatedBranch: { select: { name: true } } },
        }),
        this.prisma.admissionRecord.findMany({ where: { institutionId, admissionYear: { not: admissionYear }, nucatReference: { in: part } }, select: { nucatReference: true, admissionYear: true } }),
      ])
      for (const record of sameYear) existing.set(record.nucatReference, record)
      for (const record of elsewhere) otherYears.set(record.nucatReference, [...(otherYears.get(record.nucatReference) ?? []), record.admissionYear])
    }

    const stored: StoredRow[] = checked.map((row) => {
      const messages = [...row.messages]
      const reference = row.values.nucatReference
      const sameReference = reference ? occurrences.get(reference)! : []
      const duplicate = sameReference.length > 1
      if (duplicate) {
        const others = sameReference.filter((rowNumber) => rowNumber !== row.rowNumber)
        messages.unshift({ level: 'error', text: `Duplicate NUCAT reference in this file (also in row${others.length > 1 ? 's' : ''} ${others.join(', ')}).` })
      }
      if (reference && otherYears.has(reference)) {
        messages.push({ level: 'warning', text: `This reference also exists in ${otherYears.get(reference)!.sort().join(', ')}; those records are kept unchanged and a separate ${admissionYear} record is used.` })
      }
      if (!row.valid || duplicate) {
        return { rowNumber: row.rowNumber, outcome: row.valid ? 'DUPLICATE_IN_FILE' : 'INVALID', action: null, nucatReference: reference, data: row.values, changes: null, messages, existingRecordId: null }
      }
      const current = existing.get(reference!)
      if (!current) return { rowNumber: row.rowNumber, outcome: 'VALID', action: 'INSERT', nucatReference: reference, data: row.values, changes: null, messages, existingRecordId: null }
      const changes = diffRecord({ ...current, branchName: current.allocatedBranch?.name ?? null }, row.values)
      const changed = Object.keys(changes).length > 0
      messages.push({ level: 'warning', text: changed ? `Already exists in ${admissionYear} with different values.` : `Already exists in ${admissionYear} with the same values.` })
      return { rowNumber: row.rowNumber, outcome: 'VALID', action: changed ? 'UPDATE' : 'UNCHANGED', nucatReference: reference, data: row.values, changes: changed ? changes : null, messages, existingRecordId: current.id }
    })

    const count = (predicate: (row: StoredRow) => boolean) => stored.filter(predicate).length
    const sourceSha256 = createHash('sha256').update(file.buffer).digest('hex')
    const notices: string[] = []
    const previous = await this.prisma.admissionImportBatch.findFirst({
      where: { institutionId, admissionYear, sourceSha256, status: { in: ['APPLIED', 'PARTIAL'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    })
    if (previous) notices.push(`This exact file was already imported for ${admissionYear} on ${previous.createdAt.toISOString().slice(0, 10)}. Importing it again changes nothing that is already identical.`)
    if (!columns.matched.some((column) => column.field === 'officialEmail')) notices.push('The file has no email column, so students cannot verify these records online.')
    const knownBranches = new Set((await this.prisma.branch.findMany({ where: { institutionId }, select: { name: true } })).map((branch) => branch.name.toLowerCase()))
    const newBranches = [...new Set(stored.filter((row) => row.outcome === 'VALID' && row.data.allocatedBranch && !knownBranches.has(row.data.allocatedBranch.toLowerCase())).map((row) => row.data.allocatedBranch!))]
    if (newBranches.length) notices.push(`New branch name${newBranches.length > 1 ? 's' : ''} will be added: ${newBranches.slice(0, 10).join(', ')}${newBranches.length > 10 ? '…' : ''}.`)
    const columnInfo: ColumnInfo = { matched: columns.matched, ignored: columns.ignored, notices }

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.admissionImportBatch.create({
        data: {
          institutionId, admissionYear, status: 'VALIDATED', sourceFileName: fileName, sourceSha256, rowCount: stored.length,
          validCount: count((row) => row.outcome === 'VALID'), invalidCount: count((row) => row.outcome === 'INVALID'), duplicateCount: count((row) => row.outcome === 'DUPLICATE_IN_FILE'),
          newCount: count((row) => row.action === 'INSERT'), changedCount: count((row) => row.action === 'UPDATE'), unchangedCount: count((row) => row.action === 'UNCHANGED'),
          importedBy: account.email, createdById: account.id, columnMapping: columnInfo as unknown as Prisma.InputJsonValue,
          previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
        },
        select: { id: true },
      })
      for (const part of chunks(stored)) {
        await tx.admissionImportRow.createMany({
          data: part.map((row) => ({
            batchId: created.id, rowNumber: row.rowNumber, outcome: row.outcome, action: row.action, nucatReference: row.nucatReference,
            data: row.data as unknown as Prisma.InputJsonValue, changes: (row.changes ?? Prisma.DbNull) as Prisma.InputJsonValue,
            messages: row.messages as unknown as Prisma.InputJsonValue, existingRecordId: row.existingRecordId,
          })),
        })
      }
      await this.audit.record({
        actorType: actorTypeFor(account.role), actorId: account.id, action: 'ADMISSION_IMPORT_PREVIEWED', entityType: 'AdmissionImportBatch', entityId: created.id,
        metadata: { admissionYear, rows: stored.length },
      }, tx)
      return created
    }, { timeout: 60_000 })
    return this.get(account, batch.id)
  }

  /**
   * Applies a previewed batch. Single transaction: if anything fails (including records that changed since the preview)
   * nothing is written and the batch is marked FAILED. A batch can be committed only once.
   */
  async commit(account: AuthenticatedAccount, batchId: string, policy: ImportDuplicatePolicy) {
    const institutionId = requireInstitution(account)
    const batch = await this.prisma.admissionImportBatch.findFirst({ where: { id: batchId, institutionId }, select: { id: true, status: true, previewExpiresAt: true, createdAt: true, admissionYear: true, validCount: true } })
    if (!batch) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Import not found.')
    const now = new Date()
    this.assertCommittable(batch.status, batch.previewExpiresAt, now)
    if (batch.validCount === 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'This file has no valid rows to import.')

    try {
      await this.prisma.$transaction((tx) => this.apply(tx, account, institutionId, batch, policy, now), { timeout: 120_000, maxWait: 10_000 })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'IMPORT_ALREADY_PROCESSED') throw error
      const stale = (error instanceof ApiError && error.code === 'IMPORT_STALE') || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      const reason = stale ? 'Admission records changed after the preview. No records were changed; upload the file again for a fresh preview.' : 'The import could not be completed. No records were changed.'
      if (!stale) this.logger.error(`Import ${batchId} failed`, error instanceof Error ? error.stack : String(error))
      await this.prisma.$transaction(async (tx) => {
        const marked = await tx.admissionImportBatch.updateMany({ where: { id: batchId, status: 'VALIDATED' }, data: { status: 'FAILED', failureReason: reason, duplicatePolicy: policy } })
        if (marked.count) {
          await this.audit.record({ actorType: actorTypeFor(account.role), actorId: account.id, action: 'ADMISSION_IMPORT_FAILED', entityType: 'AdmissionImportBatch', entityId: batchId, metadata: { stale } }, tx)
        }
      })
      throw stale ? new ApiError(HttpStatus.CONFLICT, 'IMPORT_STALE', reason) : new ApiError(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', reason)
    }
    return this.get(account, batchId)
  }

  private async apply(tx: Tx, account: AuthenticatedAccount, institutionId: string, batch: { id: string; createdAt: Date; admissionYear: number }, policy: ImportDuplicatePolicy, now: Date) {
    // Claim the batch inside the transaction: a concurrent or repeated commit finds it no longer VALIDATED.
    const claimed = await tx.admissionImportBatch.updateMany({ where: { id: batch.id, status: 'VALIDATED', previewExpiresAt: { gt: now } }, data: { status: 'PROCESSING', duplicatePolicy: policy } })
    if (claimed.count !== 1) throw new ApiError(HttpStatus.CONFLICT, 'IMPORT_ALREADY_PROCESSED', 'This import was already confirmed, cancelled or has expired.')

    const rows = (await tx.admissionImportRow.findMany({
      where: { batchId: batch.id, outcome: 'VALID' }, orderBy: { rowNumber: 'asc' },
      select: { id: true, action: true, nucatReference: true, data: true, changes: true, existingRecordId: true },
    })).map((row) => ({ ...row, data: row.data as unknown as RowValues, changes: row.changes as unknown as FieldChanges | null }))
    const inserts = rows.filter((row) => row.action === 'INSERT')
    const updates = policy === 'UPDATE_EXISTING' ? rows.filter((row) => row.action === 'UPDATE') : []

    // Branches named in the file are matched case-insensitively, and created when new (they are official data too).
    const branchIds = new Map((await tx.branch.findMany({ where: { institutionId }, select: { id: true, name: true } })).map((branch) => [branch.name.toLowerCase(), branch.id]))
    const neededBranches = new Set<string>()
    for (const row of inserts) if (row.data.allocatedBranch) neededBranches.add(row.data.allocatedBranch)
    for (const row of updates) if (row.changes?.allocatedBranch) neededBranches.add(String(row.changes.allocatedBranch.to))
    for (const name of neededBranches) {
      if (branchIds.has(name.toLowerCase())) continue
      const created = await tx.branch.create({ data: { institutionId, name, code: branchCode(name) }, select: { id: true } })
      branchIds.set(name.toLowerCase(), created.id)
    }

    // New records. The (institution, year, reference) unique constraint turns a record created since the preview
    // into P2002, which rolls the whole transaction back.
    const createdRecords: { id: string }[] = []
    for (const part of chunks(inserts)) {
      createdRecords.push(...await tx.admissionRecord.createManyAndReturn({
        data: part.map((row) => ({
          institutionId, admissionYear: batch.admissionYear, nucatReference: row.nucatReference!, studentName: row.data.studentName!,
          nucatRank: row.data.nucatRank, admissionStatus: row.data.admissionStatus, officialEmail: row.data.officialEmail, feeCategory: row.data.feeCategory ?? null,
          allocatedBranchId: row.data.allocatedBranch ? branchIds.get(row.data.allocatedBranch.toLowerCase())! : null, lastImportBatchId: batch.id,
        })),
        select: { id: true },
      }))
    }

    // Updates only touch records that nobody changed since the preview (optimistic check on updatedAt).
    for (const row of updates) {
      const changes = row.changes ?? {}
      const updated = await tx.admissionRecord.updateMany({
        where: { id: row.existingRecordId!, institutionId, admissionYear: batch.admissionYear, updatedAt: { lte: batch.createdAt } },
        data: {
          ...(changes.studentName ? { studentName: String(changes.studentName.to) } : {}),
          ...(changes.nucatRank ? { nucatRank: Number(changes.nucatRank.to) } : {}),
          ...(changes.admissionStatus ? { admissionStatus: String(changes.admissionStatus.to) } : {}),
          ...(changes.officialEmail ? { officialEmail: String(changes.officialEmail.to) } : {}),
          ...(changes.feeCategory ? { feeCategory: changes.feeCategory.to as FeeCategory } : {}),
          ...(changes.allocatedBranch ? { allocatedBranchId: branchIds.get(String(changes.allocatedBranch.to).toLowerCase())! } : {}),
          lastImportBatchId: batch.id,
        },
      })
      if (updated.count !== 1) throw new ApiError(HttpStatus.CONFLICT, 'IMPORT_STALE', 'Admission records changed after the preview.')
    }

    await tx.admissionImportRow.updateMany({ where: { batchId: batch.id, outcome: { not: 'VALID' } }, data: { result: 'REJECTED' } })
    await tx.admissionImportRow.updateMany({ where: { batchId: batch.id, action: 'INSERT' }, data: { result: 'INSERTED' } })
    await tx.admissionImportRow.updateMany({ where: { batchId: batch.id, action: 'UNCHANGED' }, data: { result: 'SKIPPED' } })
    await tx.admissionImportRow.updateMany({ where: { batchId: batch.id, action: 'UPDATE' }, data: { result: policy === 'UPDATE_EXISTING' ? 'UPDATED' : 'SKIPPED' } })

    const actorType = actorTypeFor(account.role)
    for (const part of chunks(createdRecords)) {
      await tx.auditEvent.createMany({ data: part.map((record) => ({ actorType, actorId: account.id, action: 'ADMISSION_RECORD_CREATED_BY_IMPORT', entityType: 'AdmissionRecord', entityId: record.id, metadata: { batchId: batch.id } })) })
    }
    for (const part of chunks(updates)) {
      await tx.auditEvent.createMany({ data: part.map((row) => ({ actorType, actorId: account.id, action: 'ADMISSION_RECORD_UPDATED_BY_IMPORT', entityType: 'AdmissionRecord', entityId: row.existingRecordId, metadata: { batchId: batch.id, changes: row.changes } as unknown as Prisma.InputJsonValue })) })
    }

    const totals = await tx.admissionImportBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { invalidCount: true, duplicateCount: true, changedCount: true, unchangedCount: true } })
    const rejected = totals.invalidCount + totals.duplicateCount
    const skipped = totals.unchangedCount + (policy === 'SKIP_EXISTING' ? totals.changedCount : 0)
    await tx.admissionImportBatch.update({
      where: { id: batch.id },
      data: { status: rejected ? 'PARTIAL' : 'APPLIED', appliedAt: new Date(), createdCount: createdRecords.length, updatedCount: updates.length, skippedCount: skipped, rejectedCount: rejected },
    })
    await this.audit.record({
      actorType, actorId: account.id, action: 'ADMISSION_IMPORT_COMMITTED', entityType: 'AdmissionImportBatch', entityId: batch.id,
      metadata: { admissionYear: batch.admissionYear, policy, inserted: createdRecords.length, updated: updates.length, skipped, rejected },
    }, tx)
  }

  async cancel(account: AuthenticatedAccount, batchId: string) {
    const institutionId = requireInstitution(account)
    await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.admissionImportBatch.updateMany({ where: { id: batchId, institutionId, status: 'VALIDATED' }, data: { status: 'CANCELLED' } })
      if (cancelled.count !== 1) {
        const exists = await tx.admissionImportBatch.findFirst({ where: { id: batchId, institutionId }, select: { id: true } })
        throw exists ? new ApiError(HttpStatus.CONFLICT, 'IMPORT_ALREADY_PROCESSED', 'Only an import that is awaiting confirmation can be cancelled.') : new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Import not found.')
      }
      await this.audit.record({ actorType: actorTypeFor(account.role), actorId: account.id, action: 'ADMISSION_IMPORT_CANCELLED', entityType: 'AdmissionImportBatch', entityId: batchId }, tx)
    })
    return this.get(account, batchId)
  }

  async list(account: AuthenticatedAccount, query: { page: number; pageSize: number; admissionYear?: number }) {
    const institutionId = requireInstitution(account)
    const where: Prisma.AdmissionImportBatchWhereInput = { institutionId, status: { not: 'PENDING' }, ...(query.admissionYear ? { admissionYear: query.admissionYear } : {}) }
    const [total, batches] = await Promise.all([
      this.prisma.admissionImportBatch.count({ where }),
      this.prisma.admissionImportBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: batchSelect }),
    ])
    return { items: batches.map((batch) => present(batch)), total, page: query.page, pageSize: query.pageSize }
  }

  async get(account: AuthenticatedAccount, batchId: string) {
    const institutionId = requireInstitution(account)
    const batch = await this.prisma.admissionImportBatch.findFirst({ where: { id: batchId, institutionId }, select: { ...batchSelect, columnMapping: true } })
    if (!batch) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Import not found.')
    return { ...present(batch), columns: (batch.columnMapping as ColumnInfo | null) ?? { matched: [], ignored: [], notices: [] } }
  }

  async rows(account: AuthenticatedAccount, batchId: string, query: { filter: RowFilter; page: number; pageSize: number }) {
    const institutionId = requireInstitution(account)
    const batch = await this.prisma.admissionImportBatch.findFirst({ where: { id: batchId, institutionId }, select: { id: true } })
    if (!batch) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Import not found.')
    const where: Prisma.AdmissionImportRowWhereInput = { batchId, ...rowFilters[query.filter] }
    const [total, rows] = await Promise.all([
      this.prisma.admissionImportRow.count({ where }),
      this.prisma.admissionImportRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ])
    return { items: rows.map(presentRow), total, page: query.page, pageSize: query.pageSize }
  }

  /** CSV validation report. Cells are neutralised so spreadsheet apps never evaluate them as formulas. */
  async reportCsv(account: AuthenticatedAccount, batchId: string, scope: 'issues' | 'all') {
    const summary = await this.get(account, batchId)
    const rows = await this.prisma.admissionImportRow.findMany({ where: { batchId, ...(scope === 'issues' ? rowFilters.issues : {}) }, orderBy: { rowNumber: 'asc' } })
    const header = ['Row', 'Status', 'NUCAT Reference', 'Student Name', 'Planned action', 'Result', 'Issues']
    const lines = rows.map(presentRow).map((row) => [
      String(row.rowNumber), statusLabel(row.outcome), row.nucatReference ?? '', row.studentName ?? '', row.action ?? '', row.result ?? '',
      row.messages.map((message) => `${message.level === 'error' ? 'Error' : 'Note'}: ${message.text}`).join(' | '),
    ])
    const csv = [header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n')
    const base = summary.fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
    return { fileName: `${base || 'import'}-validation-report.csv`, csv: `\uFEFF${csv}\r\n` }
  }

  private assertCommittable(status: ImportBatchStatus, previewExpiresAt: Date | null, now: Date) {
    if (status !== 'VALIDATED') throw new ApiError(HttpStatus.CONFLICT, 'IMPORT_ALREADY_PROCESSED', `This import is already ${publicStatus(status, previewExpiresAt, now).replace('_', ' ')}.`)
    if (!previewExpiresAt || previewExpiresAt <= now) throw new ApiError(HttpStatus.CONFLICT, 'IMPORT_PREVIEW_EXPIRED', 'This preview has expired. Upload the file again to review it before importing.')
  }
}

const batchSelect = {
  id: true, sourceFileName: true, admissionYear: true, status: true, rowCount: true, validCount: true, invalidCount: true, duplicateCount: true,
  newCount: true, changedCount: true, unchangedCount: true, createdCount: true, updatedCount: true, skippedCount: true, rejectedCount: true,
  duplicatePolicy: true, failureReason: true, previewExpiresAt: true, createdAt: true, appliedAt: true, importedBy: true,
  createdBy: { select: { displayName: true, email: true } },
} as const satisfies Prisma.AdmissionImportBatchSelect

type BatchRow = Prisma.AdmissionImportBatchGetPayload<{ select: typeof batchSelect }>

function present(batch: BatchRow) {
  return {
    id: batch.id, fileName: batch.sourceFileName, admissionYear: batch.admissionYear, status: publicStatus(batch.status, batch.previewExpiresAt),
    importedBy: batch.createdBy?.displayName ?? batch.createdBy?.email ?? batch.importedBy ?? 'Unknown',
    createdAt: batch.createdAt.toISOString(), appliedAt: batch.appliedAt?.toISOString() ?? null, previewExpiresAt: batch.previewExpiresAt?.toISOString() ?? null,
    duplicatePolicy: batch.duplicatePolicy, failureReason: batch.failureReason,
    counts: {
      total: batch.rowCount, valid: batch.validCount, invalid: batch.invalidCount, duplicates: batch.duplicateCount,
      new: batch.newCount, changed: batch.changedCount, unchanged: batch.unchangedCount,
      inserted: batch.createdCount, updated: batch.updatedCount, skipped: batch.skippedCount, rejected: batch.rejectedCount,
    },
  }
}

const rowFilters: Record<RowFilter, Prisma.AdmissionImportRowWhereInput> = {
  all: {},
  issues: { OR: [{ outcome: { not: 'VALID' } }, { action: { in: ['UPDATE', 'UNCHANGED'] } }, { messages: { array_contains: [{ level: 'warning' }] } }] },
  valid: { outcome: 'VALID' },
  invalid: { outcome: 'INVALID' },
  duplicate: { outcome: 'DUPLICATE_IN_FILE' },
  new: { action: 'INSERT' },
  changed: { action: 'UPDATE' },
  unchanged: { action: 'UNCHANGED' },
}

function presentRow(row: { rowNumber: number; outcome: ImportRowOutcome; action: string | null; result: string | null; nucatReference: string | null; data: unknown; changes: unknown; messages: unknown }) {
  const data = (row.data ?? {}) as Partial<RowValues>
  return {
    rowNumber: row.rowNumber, outcome: row.outcome, action: row.action, result: row.result, nucatReference: row.nucatReference,
    studentName: data.studentName ?? null, nucatRank: data.nucatRank ?? null, allocatedBranch: data.allocatedBranch ?? null,
    admissionStatus: data.admissionStatus ?? null, hasEmail: Boolean(data.officialEmail),
    changes: (row.changes as FieldChanges | null) ?? null, messages: (row.messages as RowMessage[] | null) ?? [],
  }
}

const statusLabel = (outcome: ImportRowOutcome) => ({ VALID: 'Valid', INVALID: 'Invalid', DUPLICATE_IN_FILE: 'Duplicate' })[outcome]
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

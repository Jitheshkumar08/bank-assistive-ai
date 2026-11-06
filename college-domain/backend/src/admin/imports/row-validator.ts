import { normalizeReference } from '../../admission/admission.service.js'
import type { FeeCategory } from '../../generated/prisma/client.js'
import type { ImportField } from './import-columns.js'

/** Normalised values of one spreadsheet row. Optional values are null when the cell is blank (never invented). */
export type RowValues = {
  nucatReference: string | null
  studentName: string | null
  nucatRank: number | null
  allocatedBranch: string | null
  admissionStatus: string | null
  officialEmail: string | null
  /** Absent in rows stored before the fee-category column existed. */
  feeCategory?: FeeCategory | null
}

export type RowMessage = { level: 'error' | 'warning'; text: string }
export type CheckedRow = { rowNumber: number; values: RowValues; messages: RowMessage[]; valid: boolean }

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /-]*$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const clean = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()

const FEE_CATEGORIES: Record<string, FeeCategory> = { general: 'GENERAL', scholarship: 'SCHOLARSHIP', nri: 'NRI' }
/** "General", "general category", "NRI Category" … → enum value; anything else is not guessed. */
export const parseFeeCategory = (value: string): FeeCategory | null => FEE_CATEGORIES[value.toLowerCase().replace(/[^a-z]/g, '').replace(/category$/, '')] ?? null

/** Validates one row against the selected admission year. Pure function: no database access. */
export function checkRow(rowNumber: number, cells: Partial<Record<ImportField, string>>, admissionYear: number): CheckedRow {
  const messages: RowMessage[] = []
  const error = (text: string) => messages.push({ level: 'error', text })

  const rawReference = clean(cells.nucatReference)
  let nucatReference: string | null = null
  if (!rawReference) error('Missing NUCAT reference.')
  else if (rawReference.length < 3 || rawReference.length > 40 || !REFERENCE_PATTERN.test(rawReference)) error('NUCAT reference must be 3–40 letters, digits, spaces, "/" or "-".')
  else nucatReference = normalizeReference(rawReference)

  const studentName = clean(cells.studentName) || null
  if (!studentName) error('Missing student name.')
  else if (studentName.length > 160 || CONTROL_CHARS.test(studentName)) error('Student name is longer than 160 characters or contains invalid characters.')

  const rawYear = clean(cells.admissionYear)
  if (rawYear) {
    const year = /^\d{4}(\.0+)?$/.test(rawYear) ? Number.parseInt(rawYear, 10) : Number.NaN
    if (!Number.isInteger(year)) error(`Admission year "${rawYear.slice(0, 20)}" is not a year.`)
    else if (year !== admissionYear) error(`Admission year ${year} does not match the selected year ${admissionYear}.`)
  }

  let nucatRank: number | null = null
  const rawRank = clean(cells.nucatRank).replace(/,/g, '')
  if (rawRank) {
    const rank = /^\d+(\.0+)?$/.test(rawRank) ? Number.parseInt(rawRank, 10) : Number.NaN
    if (!Number.isSafeInteger(rank) || rank < 1) error(`NUCAT rank "${rawRank.slice(0, 20)}" must be a positive whole number.`)
    else nucatRank = rank
  }

  const allocatedBranch = clean(cells.allocatedBranch) || null
  if (allocatedBranch && (allocatedBranch.length > 160 || CONTROL_CHARS.test(allocatedBranch))) error('Branch is longer than 160 characters or contains invalid characters.')

  const admissionStatus = clean(cells.admissionStatus) || null
  if (admissionStatus && (admissionStatus.length > 80 || CONTROL_CHARS.test(admissionStatus))) error('Status is longer than 80 characters or contains invalid characters.')

  let officialEmail: string | null = null
  const rawEmail = clean(cells.officialEmail).toLowerCase()
  if (rawEmail) {
    if (rawEmail.length > 254 || !EMAIL_PATTERN.test(rawEmail)) error('Email address is not valid.')
    else officialEmail = rawEmail
  } else {
    messages.push({ level: 'warning', text: 'No email address: the student will not be able to verify this record online.' })
  }

  let feeCategory: FeeCategory | null = null
  const rawCategory = clean(cells.feeCategory)
  if (rawCategory) {
    feeCategory = parseFeeCategory(rawCategory)
    if (!feeCategory) error(`Fee category "${rawCategory.slice(0, 30)}" must be General, Scholarship or NRI.`)
  }

  const valid = !messages.some((message) => message.level === 'error')
  return {
    rowNumber,
    values: { nucatReference, studentName: studentName?.slice(0, 160) ?? null, nucatRank, allocatedBranch: allocatedBranch?.slice(0, 160) ?? null, admissionStatus: admissionStatus?.slice(0, 80) ?? null, officialEmail, feeCategory },
    messages,
    valid,
  }
}

export type ExistingRecord = { studentName: string; nucatRank: number | null; branchName: string | null; admissionStatus: string | null; officialEmail: string | null; feeCategory: FeeCategory | null }
export type FieldChanges = Partial<Record<'studentName' | 'nucatRank' | 'allocatedBranch' | 'admissionStatus' | 'officialEmail' | 'feeCategory', { from: string | number | null; to: string | number }>>

/**
 * Differences between an existing record and a row. Blank optional cells never clear existing values — the import only
 * sets values that the official file actually contains.
 */
export function diffRecord(existing: ExistingRecord, values: RowValues): FieldChanges {
  const changes: FieldChanges = {}
  if (values.studentName && values.studentName !== existing.studentName) changes.studentName = { from: existing.studentName, to: values.studentName }
  if (values.nucatRank !== null && values.nucatRank !== existing.nucatRank) changes.nucatRank = { from: existing.nucatRank, to: values.nucatRank }
  if (values.allocatedBranch && values.allocatedBranch.toLowerCase() !== (existing.branchName ?? '').toLowerCase()) changes.allocatedBranch = { from: existing.branchName, to: values.allocatedBranch }
  if (values.admissionStatus && values.admissionStatus !== existing.admissionStatus) changes.admissionStatus = { from: existing.admissionStatus, to: values.admissionStatus }
  if (values.officialEmail && values.officialEmail !== existing.officialEmail) changes.officialEmail = { from: existing.officialEmail, to: values.officialEmail }
  if (values.feeCategory && values.feeCategory !== existing.feeCategory) changes.feeCategory = { from: existing.feeCategory, to: values.feeCategory }
  return changes
}

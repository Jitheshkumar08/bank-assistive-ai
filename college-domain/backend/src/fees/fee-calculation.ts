import type { FeeCategory } from '../generated/prisma/client.js'

/**
 * Fee rules confirmed from the official Nitte "Annual Fee Structure for BTech Programs" document:
 *  - the annual tuition depends on the programme and the fee category (General / Scholarship through NUCAT, or NRI);
 *  - the exam fee is collected each academic year together with the annual tuition;
 *  - "NA" means the category is not offered for that programme.
 * Nothing here knows about payments, so no figure is ever presented as an outstanding balance.
 */

/** Programme names are matched trimmed, case-insensitively, with "&" = "and" and punctuation/spacing ignored. */
export const normalizeProgramName = (name: string) => name.normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

export type FeeScheduleRow = { academicYear: string; programName: string; category: FeeCategory; annualTuition: number | null; annualExamFee: number; sourceUrl: string }

export type FeeUnconfirmedReason =
  | 'BRANCH_NOT_ALLOCATED'
  | 'CATEGORY_NOT_RECORDED'
  | 'SCHEDULE_NOT_AVAILABLE'
  | 'SCHEDULE_AMBIGUOUS'
  | 'CATEGORY_NOT_OFFERED'

export type FeeDetails =
  | {
    status: 'CONFIRMED'
    currency: 'INR'
    period: 'ANNUAL'
    academicYear: string
    category: FeeCategory
    programName: string
    tuitionFee: number
    examFee: number
    totalAnnualFee: number
    sourceUrl: string
  }
  | { status: 'REQUIRES_CONFIRMATION'; reason: FeeUnconfirmedReason }

export const unconfirmed = (reason: FeeUnconfirmedReason): FeeDetails => ({ status: 'REQUIRES_CONFIRMATION', reason })

/**
 * What a student is shown: only the final payable amount, or that it requires confirmation. The breakdown, the
 * category and the reason stay in the backend.
 *
 * Scholarship: the official fee structure prints the fee for the Scholarship category directly (it is already net of
 * the scholarship), so a confirmed scholarship = the official "Fee Category" Scholarship on the admission record +
 * the official Scholarship row of the schedule. No deduction is ever derived, assumed or applied on top of that, and
 * a record without a category is never treated as General.
 */
export type StudentFee = { status: 'CONFIRMED'; currency: 'INR'; finalPayableAmount: number } | { status: 'REQUIRES_CONFIRMATION' }

export function toStudentFee(fee: FeeDetails): StudentFee {
  if (fee.status !== 'CONFIRMED') return { status: 'REQUIRES_CONFIRMATION' }
  const amount = fee.tuitionFee + fee.examFee
  // Defensive: an inconsistent or impossible figure is never shown.
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount !== fee.totalAnnualFee || fee.tuitionFee < 0 || fee.examFee < 0) return { status: 'REQUIRES_CONFIRMATION' }
  return { status: 'CONFIRMED', currency: 'INR', finalPayableAmount: amount }
}

/**
 * Applies the confirmed rules to the schedule rows that matched the record's programme, year and category.
 * Pure function: exactly one matching row with a published amount produces a figure; anything else is unconfirmed.
 */
export function calculateFee(record: { branchName: string | null; feeCategory: FeeCategory | null }, matches: FeeScheduleRow[]): FeeDetails {
  if (!record.branchName) return unconfirmed('BRANCH_NOT_ALLOCATED')
  if (!record.feeCategory) return unconfirmed('CATEGORY_NOT_RECORDED')
  const rows = matches.filter((row) => row.category === record.feeCategory)
  if (rows.length === 0) return unconfirmed('SCHEDULE_NOT_AVAILABLE')
  if (rows.length > 1) return unconfirmed('SCHEDULE_AMBIGUOUS')
  const [row] = rows
  if (row.annualTuition === null) return unconfirmed('CATEGORY_NOT_OFFERED')
  return {
    status: 'CONFIRMED',
    currency: 'INR',
    period: 'ANNUAL',
    academicYear: row.academicYear,
    category: row.category,
    programName: row.programName,
    tuitionFee: row.annualTuition,
    examFee: row.annualExamFee,
    totalAnnualFee: row.annualTuition + row.annualExamFee,
    sourceUrl: row.sourceUrl,
  }
}

import { describe, expect, it } from 'vitest'
import { ServiceError } from '../errors'
import { admissionService, parseAdmissionDetails } from './admissionService'

const confirmedFee = { status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 360000 }
const record = { studentName: '  Asha Rao ', nucatRank: 152, allocatedBranch: 'Computer Science', admissionStatus: 'Allotted', admissionYear: 2026, fee: confirmedFee }

describe('admission details contract', () => {
  it('accepts a well-formed { details } response', () => {
    expect(parseAdmissionDetails({ details: record })).toEqual({
      studentName: 'Asha Rao', nucatRank: 152, allocatedBranch: 'Computer Science', admissionStatus: 'Allotted', admissionYear: 2026,
      fee: { status: 'CONFIRMED', finalPayableAmount: 360000 },
    })
  })

  it('keeps unpublished rank and unallocated branch as null', () => {
    expect(parseAdmissionDetails({ details: { ...record, nucatRank: null, allocatedBranch: null } })).toMatchObject({ nucatRank: null, allocatedBranch: null })
  })

  it.each([
    ['a missing amount', { status: 'CONFIRMED', currency: 'INR' }],
    ['a text amount', { ...confirmedFee, finalPayableAmount: '360000' }],
    ['a zero amount', { ...confirmedFee, finalPayableAmount: 0 }],
    ['a negative amount', { ...confirmedFee, finalPayableAmount: -360000 }],
    ['a fractional amount', { ...confirmedFee, finalPayableAmount: 360000.5 }],
    ['another currency', { ...confirmedFee, currency: 'USD' }],
    ['an unknown status', { ...confirmedFee, status: 'ESTIMATED' }],
    ['"requires confirmation" with an amount attached', { status: 'REQUIRES_CONFIRMATION', finalPayableAmount: 360000 }],
    ['no fee at all', undefined],
  ])('never shows an amount for a fee with %s', (_label, fee) => {
    expect(parseAdmissionDetails({ details: { ...record, fee } }).fee).toEqual({ status: 'REQUIRES_CONFIRMATION' })
  })

  it('keeps only the final amount, even if a response carried a breakdown or scholarship details', () => {
    const fee = { ...confirmedFee, tuitionFee: 350000, examFee: 10000, category: 'SCHOLARSHIP', scholarshipAmount: 150000, reason: 'X' }
    expect(parseAdmissionDetails({ details: { ...record, fee } }).fee).toEqual({ status: 'CONFIRMED', finalPayableAmount: 360000 })
  })

  it.each([
    ['missing', null],
    ['an unwrapped record', record],
    ['an array of records', { details: [record] }],
    ['no name', { details: { ...record, studentName: ' ' } }],
    ['a text rank', { details: { ...record, nucatRank: '1245' } }],
    ['a fractional rank', { details: { ...record, nucatRank: 1.5 } }],
    ['a non-text branch', { details: { ...record, allocatedBranch: 7 } }],
  ])('rejects a response with %s', (_label, value) => {
    expect(() => parseAdmissionDetails(value)).toThrow(ServiceError)
  })

  it('reports "not connected" (never details) when no backend URL is configured', async () => {
    await expect(admissionService.getDetails({ collegeId: 'nmamit', area: 'admissions-desk' })).rejects.toMatchObject({ code: 'BACKEND_NOT_CONNECTED' })
  })
})

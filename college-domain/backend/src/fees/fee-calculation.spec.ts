import { readFileSync } from 'node:fs'
import { calculateFee, normalizeProgramName, toStudentFee, type FeeScheduleRow } from './fee-calculation.js'
import { feeRowsFromFile } from './fee-schedule-file.js'

const source = 'https://nitte.edu.in/fee/BTECH.pdf'
const row = (category: FeeScheduleRow['category'], annualTuition: number | null): FeeScheduleRow => ({ academicYear: '2026-27', programName: 'Computer Science', category, annualTuition, annualExamFee: 10000, sourceUrl: source })

describe('fee calculation (confirmed rules)', () => {
  it('annual total = tuition for the category + exam fee, labelled annual (not a balance)', () => {
    expect(calculateFee({ branchName: 'Computer Science', feeCategory: 'GENERAL' }, [row('GENERAL', 350000)])).toEqual({
      status: 'CONFIRMED', currency: 'INR', period: 'ANNUAL', academicYear: '2026-27', category: 'GENERAL', programName: 'Computer Science',
      tuitionFee: 350000, examFee: 10000, totalAnnualFee: 360000, sourceUrl: source,
    })
    expect(calculateFee({ branchName: 'Computer Science', feeCategory: 'SCHOLARSHIP' }, [row('SCHOLARSHIP', 200000)])).toMatchObject({ tuitionFee: 200000, totalAnnualFee: 210000 })
    const result = calculateFee({ branchName: 'Computer Science', feeCategory: 'NRI' }, [row('NRI', 400000)])
    expect(result).toMatchObject({ totalAnnualFee: 410000 })
    expect(Object.keys(result)).not.toContain('balance')
  })

  it.each([
    ['no branch', { branchName: null, feeCategory: 'GENERAL' as const }, [row('GENERAL', 350000)], 'BRANCH_NOT_ALLOCATED'],
    ['no category', { branchName: 'Computer Science', feeCategory: null }, [row('GENERAL', 350000)], 'CATEGORY_NOT_RECORDED'],
    ['no schedule row', { branchName: 'Computer Science', feeCategory: 'GENERAL' as const }, [], 'SCHEDULE_NOT_AVAILABLE'],
    ['only another category', { branchName: 'Computer Science', feeCategory: 'NRI' as const }, [row('GENERAL', 350000)], 'SCHEDULE_NOT_AVAILABLE'],
    ['two matching rows', { branchName: 'Computer Science', feeCategory: 'GENERAL' as const }, [row('GENERAL', 350000), row('GENERAL', 1)], 'SCHEDULE_AMBIGUOUS'],
    ['"NA" in the document', { branchName: 'Computer Science', feeCategory: 'NRI' as const }, [row('NRI', null)], 'CATEGORY_NOT_OFFERED'],
  ])('requires confirmation with %s', (_label, record, rows, reason) => {
    expect(calculateFee(record, rows)).toEqual({ status: 'REQUIRES_CONFIRMATION', reason })
  })

  describe('student-facing fee (toStudentFee)', () => {
    const quote = (category: FeeScheduleRow['category'], tuition: number) => calculateFee({ branchName: 'Computer Science', feeCategory: category }, [row(category, tuition)])

    it('exposes only the final payable amount — no breakdown, category, programme, source or reason', () => {
      const general = toStudentFee(quote('GENERAL', 350000))
      expect(general).toEqual({ status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 360000 })
      expect(Object.keys(general).sort()).toEqual(['currency', 'finalPayableAmount', 'status'])
      expect(JSON.stringify(general)).not.toMatch(/tuition|exam|scholarship|category|deduction|programme|program|source|reason|period/i)
    })

    it('a confirmed scholarship = the official Scholarship row; no extra deduction is applied', () => {
      expect(toStudentFee(quote('SCHOLARSHIP', 200000))).toEqual({ status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 210000 })
      expect(toStudentFee(quote('NRI', 400000))).toEqual({ status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 410000 })
    })

    it.each([
      ['no category (scholarship unknown — never treated as General)', calculateFee({ branchName: 'Computer Science', feeCategory: null }, [row('GENERAL', 350000)])],
      ['no schedule', calculateFee({ branchName: 'Computer Science', feeCategory: 'GENERAL' }, [])],
      ['category not offered', calculateFee({ branchName: 'Computer Science', feeCategory: 'NRI' }, [row('NRI', null)])],
      ['an inconsistent total', { ...(quote('GENERAL', 350000) as Extract<ReturnType<typeof quote>, { status: 'CONFIRMED' }>), totalAnnualFee: 1 }],
      ['a zero amount', { ...(quote('GENERAL', 0) as Extract<ReturnType<typeof quote>, { status: 'CONFIRMED' }>), examFee: 0, totalAnnualFee: 0 }],
    ])('requires confirmation (and says nothing more) with %s', (_label, fee) => {
      expect(toStudentFee(fee)).toEqual({ status: 'REQUIRES_CONFIRMATION' })
    })
  })

  it('normalises programme names without merging different programmes', () => {
    expect(normalizeProgramName('  Electrical & Electronics ')).toBe(normalizeProgramName('ELECTRICAL AND ELECTRONICS'))
    expect(normalizeProgramName('Computer Science (Cyber Security)')).not.toBe(normalizeProgramName('Computer Science'))
  })
})

describe('fee schedule file', () => {
  const file = JSON.parse(readFileSync(new URL('../../data/fee-schedules/nmamit-btech-2026-27.json', import.meta.url), 'utf8'))
  const confirmed = { ...file, confirmation: { status: 'CONFIRMED', confirmedBy: 'Fixture Reviewer', confirmedOn: '2026-10-27' } }

  it('refuses the transcription until a person has confirmed it', () => {
    expect(file.confirmation.status).toBe('PENDING')
    expect(() => feeRowsFromFile(file)).toThrow(/not been confirmed/)
    expect(() => feeRowsFromFile({ ...confirmed, confirmation: { status: 'CONFIRMED', confirmedBy: ' ', confirmedOn: '2026-10-27' } })).toThrow(/not been confirmed/)
  })

  it('expands every NMAMIT programme into General, Scholarship and NRI rows with distinct amounts per branch', () => {
    const rows = feeRowsFromFile(confirmed)
    expect(rows).toHaveLength(14 * 3)
    expect(rows.every((item) => item.institutionId === 'nmamit' && item.admissionYear === 2026 && item.annualExamFee === 10000)).toBe(true)
    const general = (name: string) => rows.find((item) => item.programName === name && item.category === 'GENERAL')!.annualTuition
    expect(general('Computer Science')).toBe(350000)
    expect(general('Civil Engineering')).toBe(150000)
    expect(rows.find((item) => item.programName === 'Civil Engineering' && item.category === 'NRI')!.annualTuition).toBe(175000)
  })

  it('rejects an alias that would match two programmes, and negative amounts', () => {
    const clash = { ...confirmed, programmes: [{ ...confirmed.programmes[0], aliases: ['Mechanical'] }, ...confirmed.programmes.slice(1)] }
    expect(() => feeRowsFromFile(clash)).toThrow(/matches both/)
    expect(() => feeRowsFromFile({ ...confirmed, programmes: [{ ...confirmed.programmes[0], general: -1 }] })).toThrow()
  })
})

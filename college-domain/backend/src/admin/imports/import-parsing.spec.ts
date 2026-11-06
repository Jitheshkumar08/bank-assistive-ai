import { resolveColumns } from './import-columns.js'
import { checkRow, diffRecord } from './row-validator.js'
import { detectKind, parseCsv } from './spreadsheet-parser.js'

describe('CSV parsing', () => {
  it('handles quotes, doubled quotes, embedded newlines and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']])
  })

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow(/unclosed/)
  })

  it('checks the file type by extension and content', () => {
    expect(detectKind('x.csv', Buffer.from('a,b'))).toBe('csv')
    expect(detectKind('x.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe('xlsx')
    expect(() => detectKind('x.xlsx', Buffer.from('a,b'))).toThrow(/not a valid .xlsx/)
    expect(() => detectKind('x.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toThrow(/plain-text/)
    expect(() => detectKind('x.exe', Buffer.from('MZ'))).toThrow(/\.xlsx or \.csv/)
  })
})

describe('column resolution', () => {
  it('matches headers case- and punctuation-insensitively and reports the rest', () => {
    const result = resolveColumns(['NUCAT Ref. No', 'name of the candidate', 'Remarks', 'E-mail'])
    expect(result.matched.map((column) => column.field)).toEqual(['nucatReference', 'studentName', 'officialEmail'])
    expect(result.ignored).toEqual(['Remarks'])
    expect(result.missing).toEqual([])
  })

  it('uses configured extra aliases and flags missing or conflicting columns', () => {
    expect(resolveColumns(['Appl No', 'Name'], { nucatReference: ['Appl No'] }).missing).toEqual([])
    expect(resolveColumns(['Name']).missing.map((column) => column.field)).toEqual(['nucatReference'])
    expect(resolveColumns(['Reference Number', 'Application Number', 'Name']).conflicts).toHaveLength(1)
  })
})

describe('row validation', () => {
  it('normalises a valid row without inventing optional values', () => {
    const row = checkRow(2, { nucatReference: ' ab 12/3 ', studentName: '  Test   Student ', nucatRank: '1,234', officialEmail: 'Test@Example.COM' }, 2025)
    expect(row.valid).toBe(true)
    expect(row.values).toEqual({ nucatReference: 'AB12/3', studentName: 'Test Student', nucatRank: 1234, allocatedBranch: null, admissionStatus: null, officialEmail: 'test@example.com', feeCategory: null })
  })

  it.each([
    [{ studentName: 'X' }, 'Missing NUCAT reference.'],
    [{ nucatReference: 'AB<script>', studentName: 'X' }, 'NUCAT reference must be'],
    [{ nucatReference: 'AB123' }, 'Missing student name.'],
    [{ nucatReference: 'AB123', studentName: 'X', nucatRank: '0' }, 'positive whole number'],
    [{ nucatReference: 'AB123', studentName: 'X', nucatRank: '12.5' }, 'positive whole number'],
    [{ nucatReference: 'AB123', studentName: 'X', admissionYear: '2024' }, 'does not match the selected year 2025'],
    [{ nucatReference: 'AB123', studentName: 'X', officialEmail: 'nope' }, 'Email address is not valid.'],
  ])('rejects %j', (cells, message) => {
    const row = checkRow(5, cells, 2025)
    expect(row.valid).toBe(false)
    expect(row.messages.map((item) => item.text).join(' ')).toContain(message)
  })

  it('accepts Excel-style numeric years and ranks ("2025.0")', () => {
    expect(checkRow(2, { nucatReference: 'AB123', studentName: 'X', admissionYear: '2025.0', nucatRank: '7.0', officialEmail: 'x@example.com' }, 2025).valid).toBe(true)
  })

  it('only reports differences for values present in the file', () => {
    const existing = { studentName: 'X', nucatRank: 5, branchName: 'CSE', admissionStatus: 'Pending', officialEmail: 'x@example.com', feeCategory: null }
    expect(diffRecord(existing, { nucatReference: 'A', studentName: 'X', nucatRank: null, allocatedBranch: 'cse', admissionStatus: null, officialEmail: null })).toEqual({})
    expect(diffRecord(existing, { nucatReference: 'A', studentName: 'X', nucatRank: 4, allocatedBranch: 'ECE', admissionStatus: 'Admitted', officialEmail: null }))
      .toEqual({ nucatRank: { from: 5, to: 4 }, allocatedBranch: { from: 'CSE', to: 'ECE' }, admissionStatus: { from: 'Pending', to: 'Admitted' } })
  })
})

describe('fee category column', () => {
  it('maps only the explicit "Fee Category" header (never a plain "Category")', () => {
    expect(resolveColumns(['NUCAT Reference', 'Name', 'Fee Category', 'Category']).matched.map((column) => column.field)).toEqual(['nucatReference', 'studentName', 'feeCategory'])
  })

  it.each([['General', 'GENERAL'], ['scholarship category', 'SCHOLARSHIP'], ['NRI Category', 'NRI'], ['', null]])('reads "%s"', (value, expected) => {
    const row = checkRow(2, { nucatReference: 'AB123', studentName: 'X', officialEmail: 'x@example.com', feeCategory: value }, 2026)
    expect(row.valid).toBe(true)
    expect(row.values.feeCategory).toBe(expected)
  })

  it('rejects an unknown category instead of guessing', () => {
    const row = checkRow(2, { nucatReference: 'AB123', studentName: 'X', feeCategory: 'GM' }, 2026)
    expect(row.valid).toBe(false)
    expect(row.messages.map((message) => message.text).join(' ')).toContain('must be General, Scholarship or NRI')
  })

  it('reports a category change but never clears one with a blank cell', () => {
    const existing = { studentName: 'X', nucatRank: null, branchName: null, admissionStatus: null, officialEmail: null, feeCategory: 'GENERAL' as const }
    const base = { nucatReference: 'A', studentName: 'X', nucatRank: null, allocatedBranch: null, admissionStatus: null, officialEmail: null }
    expect(diffRecord(existing, { ...base, feeCategory: 'NRI' })).toEqual({ feeCategory: { from: 'GENERAL', to: 'NRI' } })
    expect(diffRecord(existing, { ...base, feeCategory: null })).toEqual({})
  })
})

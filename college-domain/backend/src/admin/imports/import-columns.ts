/**
 * Column mapping for official admission spreadsheets.
 *
 * The official NMAMIT/NUCAT spreadsheet layout has NOT been confirmed yet, so headers are matched by configurable
 * aliases (case, spaces and punctuation are ignored). Extra aliases can be supplied without code changes through
 * ADMISSION_IMPORT_COLUMN_ALIASES, e.g. {"nucatReference":["NUCAT Appl No"]}. Unrecognised columns are ignored and
 * reported in the preview — nothing is guessed from their content.
 */
export type ImportField = 'nucatReference' | 'studentName' | 'admissionYear' | 'nucatRank' | 'allocatedBranch' | 'admissionStatus' | 'officialEmail' | 'feeCategory'

export type ImportColumn = { field: ImportField; label: string; required: boolean; description: string; aliases: string[] }

export const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'nucatReference', label: 'NUCAT Reference', required: true, description: 'Reference / application number printed on the NUCAT application.',
    aliases: ['NUCAT Reference', 'NUCAT Reference Number', 'NUCAT Ref', 'NUCAT Ref No', 'Reference Number', 'Reference No', 'Application Number', 'NUCAT Application Number'] },
  { field: 'studentName', label: 'Student Name', required: true, description: 'Name exactly as in the official record.',
    aliases: ['Student Name', 'Name', 'Candidate Name', 'Name of the Candidate', 'Full Name'] },
  { field: 'admissionYear', label: 'Admission Year', required: false, description: 'Optional; when present it must equal the year selected for the import.',
    aliases: ['Admission Year', 'Year', 'Academic Year', 'Batch'] },
  { field: 'nucatRank', label: 'NUCAT Rank', required: false, description: 'Positive whole number; leave blank if not published.',
    aliases: ['NUCAT Rank', 'Rank', 'Merit Rank', 'Overall Rank'] },
  { field: 'allocatedBranch', label: 'Branch', required: false, description: 'Allocated branch; leave blank if not allocated.',
    aliases: ['Allocated Branch', 'Branch', 'Branch Allotted', 'Allotted Branch', 'Course', 'Programme'] },
  { field: 'admissionStatus', label: 'Status', required: false, description: 'Admission status text as published (e.g. Admitted, Pending).',
    aliases: ['Admission Status', 'Status'] },
  { field: 'officialEmail', label: 'Email', required: false, description: 'Applicant email; required for the student to verify the record online.',
    aliases: ['Email', 'Email Address', 'Email ID', 'E-mail', 'Official Email', 'Applicant Email'] },
  // Deliberately no plain "Category" alias: official sheets may use that header for reservation categories.
  { field: 'feeCategory', label: 'Fee Category', required: false, description: 'General, Scholarship or NRI, as in the official fee structure; leave blank if not decided.',
    aliases: ['Fee Category', 'Fee Type'] },
]

export const normalizeHeader = (header: string) => header.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')

export type ColumnResolution = {
  /** Column index → field. */
  byIndex: Map<number, ImportField>
  matched: { header: string; field: ImportField; label: string }[]
  ignored: string[]
  missing: ImportColumn[]
  conflicts: string[]
}

/** Matches spreadsheet headers to fields. Two headers for the same field are a conflict (the file is rejected). */
export function resolveColumns(headers: string[], extraAliases: Partial<Record<ImportField, string[]>> = {}): ColumnResolution {
  const aliasToField = new Map<string, ImportField>()
  for (const column of IMPORT_COLUMNS) {
    for (const alias of [...column.aliases, ...(extraAliases[column.field] ?? [])]) aliasToField.set(normalizeHeader(alias), column.field)
  }
  const byIndex = new Map<number, ImportField>()
  const seen = new Map<ImportField, string>()
  const matched: ColumnResolution['matched'] = []
  const ignored: string[] = []
  const conflicts: string[] = []
  headers.forEach((header, index) => {
    const field = header.trim() ? aliasToField.get(normalizeHeader(header)) : undefined
    if (!field) {
      if (header.trim()) ignored.push(header.trim())
      return
    }
    if (seen.has(field)) {
      conflicts.push(`Both "${seen.get(field)}" and "${header.trim()}" map to ${IMPORT_COLUMNS.find((column) => column.field === field)!.label}.`)
      return
    }
    seen.set(field, header.trim())
    byIndex.set(index, field)
    matched.push({ header: header.trim(), field, label: IMPORT_COLUMNS.find((column) => column.field === field)!.label })
  })
  const missing = IMPORT_COLUMNS.filter((column) => column.required && !seen.has(column.field))
  return { byIndex, matched, ignored, missing, conflicts }
}

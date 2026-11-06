import { HttpStatus } from '@nestjs/common'
import ExcelJS from 'exceljs'
import { ApiError } from '../../common/api-error.js'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 10_000
const MAX_COLUMNS = 60
const MAX_CELL_LENGTH = 500

export type SheetRow = { rowNumber: number; cells: string[] }
export type ParsedSheet = { kind: 'xlsx' | 'csv'; headers: string[]; rows: SheetRow[] }

const invalidFile = (message: string) => new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_FILE', message)

/** Detects the format from the extension AND the content; anything else is rejected before parsing. */
export function detectKind(fileName: string, buffer: Buffer): 'xlsx' | 'csv' {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
  if (extension === 'xlsx') {
    if (!isZip) throw invalidFile('This file is not a valid .xlsx workbook.')
    return 'xlsx'
  }
  if (extension === 'csv') {
    if (isZip || buffer.includes(0)) throw invalidFile('This file is not a plain-text CSV file.')
    return 'csv'
  }
  if (extension === 'xls') throw invalidFile('Old .xls workbooks are not supported. Save the file as .xlsx or .csv and upload it again.')
  throw invalidFile('Upload an .xlsx or .csv file.')
}

export async function parseSpreadsheet(fileName: string, buffer: Buffer): Promise<ParsedSheet> {
  if (!buffer.length) throw invalidFile('The file is empty.')
  if (buffer.length > MAX_IMPORT_BYTES) throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'FILE_TOO_LARGE', 'The file is larger than 5 MB.')
  const kind = detectKind(fileName, buffer)
  const table = kind === 'xlsx' ? await readXlsx(buffer) : readCsv(buffer)
  return { kind, ...splitHeader(table) }
}

/** The first non-empty row is the header; fully empty rows are skipped but row numbers stay as shown in the file. */
function splitHeader(table: SheetRow[]): Omit<ParsedSheet, 'kind'> {
  const nonEmpty = table.filter((row) => row.cells.some((cell) => cell.trim()))
  if (!nonEmpty.length) throw invalidFile('The file has no header row.')
  const [header, ...rows] = nonEmpty
  if (header.cells.length > MAX_COLUMNS) throw invalidFile(`The file has more than ${MAX_COLUMNS} columns.`)
  if (!rows.length) throw invalidFile('The file has a header row but no data rows.')
  if (rows.length > MAX_IMPORT_ROWS) throw invalidFile(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} data rows. Split it into smaller files.`)
  for (const row of rows) {
    if (row.cells.some((cell) => cell.length > MAX_CELL_LENGTH)) throw invalidFile(`Row ${row.rowNumber} has a cell longer than ${MAX_CELL_LENGTH} characters.`)
  }
  return { headers: header.cells.map((cell) => cell.trim()), rows }
}

async function readXlsx(buffer: Buffer): Promise<SheetRow[]> {
  const workbook = new ExcelJS.Workbook()
  try {
    // ExcelJS expects its own Buffer type; the bytes are the same.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    throw invalidFile('This .xlsx workbook could not be read. Open it in Excel, save it again and retry.')
  }
  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 0)
  if (!sheet) throw invalidFile('The workbook has no data.')
  if (sheet.actualRowCount > MAX_IMPORT_ROWS + 50) throw invalidFile(`The sheet has more than ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows. Split it into smaller files.`)
  const rows: SheetRow[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = []
    const count = Math.min(row.cellCount, MAX_COLUMNS + 1)
    for (let column = 1; column <= count; column += 1) cells.push(cellText(row.getCell(column).value))
    rows.push({ rowNumber, cells })
  })
  return rows
}

/** Plain text of a cell; formulas use their cached result, dates become YYYY-MM-DD, errors become empty. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('error' in value) return ''
    if ('result' in value) return cellText((value as { result?: ExcelJS.CellValue }).result ?? null)
    if ('text' in value) return cellText((value as { text: ExcelJS.CellValue }).text)
  }
  return ''
}

function readCsv(buffer: Buffer): SheetRow[] {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw invalidFile('The CSV file is not UTF-8 encoded. In Excel use "Save As → CSV UTF-8".')
  }
  return parseCsv(text.replace(/^\uFEFF/, '')).map((cells, index) => ({ rowNumber: index + 1, cells }))
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. Delimiter auto-detected (comma, semicolon or tab). */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1 } else quoted = false
      } else field += char
      continue
    }
    if (char === '"' && field === '') quoted = true
    else if (char === delimiter) { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field); rows.push(row); row = []; field = ''
    } else field += char
  }
  if (quoted) throw invalidFile('The CSV file has an unclosed quotation mark.')
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function detectDelimiter(text: string) {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/)).replace(/"[^"]*"/g, '')
  const counts = [',', ';', '\t'].map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 }))
  return counts.sort((a, b) => b.count - a.count)[0].count > 0 ? counts[0].candidate : ','
}

import { apiBlob, apiDownload, apiRequest } from '../http'
import type {
  AdminDashboard, AdmissionYearRow, AuditEntry, DuplicatePolicy, ImportColumns, ImportDetail, ImportRow, ImportSummary, Paged, QrCodeReader, RecordFilters,
  RecordUpdate, RowFilter, StudentRecordDetail, StudentRecordQuery, StudentRecordRow,
} from './adminTypes'

/** College Admin API. The backend scopes everything to the admin's own college and checks the role on every call. */
export interface AdminService {
  dashboard(): Promise<AdminDashboard>
  records(query: StudentRecordQuery): Promise<Paged<StudentRecordRow>>
  recordFilters(): Promise<RecordFilters>
  record(id: string): Promise<StudentRecordDetail>
  updateRecord(id: string, update: RecordUpdate): Promise<StudentRecordDetail>
  recordHistory(id: string): Promise<{ items: AuditEntry[] }>
  admissionYears(): Promise<{ items: AdmissionYearRow[] }>
  importColumns(): Promise<ImportColumns>
  previewImport(file: File, admissionYear: number): Promise<ImportDetail>
  imports(query: { page?: number; pageSize?: number; admissionYear?: number }): Promise<Paged<ImportSummary>>
  importDetail(id: string): Promise<ImportDetail>
  importRows(id: string, query: { filter?: RowFilter; page?: number; pageSize?: number }): Promise<Paged<ImportRow>>
  commitImport(id: string, duplicatePolicy: DuplicatePolicy): Promise<ImportDetail>
  cancelImport(id: string): Promise<ImportDetail>
  downloadReport(id: string, scope?: 'issues' | 'all'): Promise<void>
  downloadTemplate(): Promise<void>
  /** QR codes of the admin's own college: read and download only. */
  qrCodes: QrCodeReader
}

const what = 'The College Admin portal'

/** QR list + image endpoints under `basePath` (/admin/qr-codes or /super-admin/qr-codes). */
export function qrCodeReader(basePath: string, portal: string): QrCodeReader {
  const imagePath = (id: string, format: string) => `${basePath}/${encodeURIComponent(id)}/qr.${format}`
  return {
    list: () => apiRequest(basePath, {}, portal),
    image: async (id, format) => (await apiBlob(imagePath(id, format), portal)).blob,
    download: (placement, format) => apiDownload(imagePath(placement.id, format), `campusguide-qr-${placement.institution.id}-${placement.areaSlug}.${format}`, portal),
  }
}

export function queryString(query: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  const text = params.toString()
  return text ? `?${text}` : ''
}

const get = <T>(path: string) => apiRequest<T>(path, {}, what)
const post = <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, what)

export const httpAdminService: AdminService = {
  dashboard: () => get('/admin/dashboard'),
  records: (query) => get(`/admin/student-records${queryString(query)}`),
  recordFilters: () => get('/admin/student-records/filters'),
  record: (id) => get(`/admin/student-records/${encodeURIComponent(id)}`),
  updateRecord: (id, update) => apiRequest(`/admin/student-records/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) }, what),
  recordHistory: (id) => get(`/admin/student-records/${encodeURIComponent(id)}/history`),
  admissionYears: () => get('/admin/admission-years'),
  importColumns: () => get('/admin/admission-imports/columns'),
  previewImport: (file, admissionYear) => {
    const form = new FormData()
    form.append('admissionYear', String(admissionYear))
    form.append('file', file)
    return apiRequest('/admin/admission-imports/preview', { method: 'POST', body: form }, what)
  },
  imports: (query) => get(`/admin/admission-imports${queryString(query)}`),
  importDetail: (id) => get(`/admin/admission-imports/${encodeURIComponent(id)}`),
  importRows: (id, query) => get(`/admin/admission-imports/${encodeURIComponent(id)}/rows${queryString(query)}`),
  commitImport: (id, duplicatePolicy) => post(`/admin/admission-imports/${encodeURIComponent(id)}/commit`, { duplicatePolicy }),
  cancelImport: (id) => post(`/admin/admission-imports/${encodeURIComponent(id)}/cancel`),
  downloadReport: (id, scope = 'issues') => apiDownload(`/admin/admission-imports/${encodeURIComponent(id)}/report.csv${queryString({ scope })}`, 'validation-report.csv', what),
  downloadTemplate: () => apiDownload('/admin/admission-imports/template.csv', 'admission-import-template.csv', what),
  qrCodes: qrCodeReader('/admin/qr-codes', what),
}

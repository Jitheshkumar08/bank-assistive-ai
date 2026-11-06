/** Response shapes of the College Admin API (backend/src/admin). */

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number }

export type ImportStatus = 'awaiting_confirmation' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'expired' | 'pending'
export type DuplicatePolicy = 'SKIP_EXISTING' | 'UPDATE_EXISTING'

export type AuditEntry = {
  id: string
  action: string
  description: string
  actorType: string
  actorName: string
  entityType: string
  entityId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type ImportSummary = {
  id: string
  fileName: string
  admissionYear: number
  status: ImportStatus
  importedBy: string
  createdAt: string
  appliedAt: string | null
  previewExpiresAt: string | null
  duplicatePolicy: DuplicatePolicy | null
  failureReason: string | null
  counts: {
    total: number; valid: number; invalid: number; duplicates: number; new: number; changed: number; unchanged: number
    inserted: number; updated: number; skipped: number; rejected: number
  }
}

export type ImportDetail = ImportSummary & {
  columns: { matched: { header: string; field: string; label: string }[]; ignored: string[]; notices: string[] }
}

export type FieldChange = { from: string | number | null; to: string | number | null }

export type ImportRow = {
  rowNumber: number
  outcome: 'VALID' | 'INVALID' | 'DUPLICATE_IN_FILE'
  action: 'INSERT' | 'UPDATE' | 'UNCHANGED' | null
  result: 'INSERTED' | 'UPDATED' | 'SKIPPED' | 'REJECTED' | null
  nucatReference: string | null
  studentName: string | null
  nucatRank: number | null
  allocatedBranch: string | null
  admissionStatus: string | null
  hasEmail: boolean
  changes: Record<string, FieldChange> | null
  messages: { level: 'error' | 'warning'; text: string }[]
}

export type RowFilter = 'all' | 'issues' | 'valid' | 'invalid' | 'duplicate' | 'new' | 'changed' | 'unchanged'

export type ImportColumns = {
  columns: { field: string; label: string; required: boolean; description: string; aliases: string[] }[]
  limits: { maxBytes: number; maxRows: number; fileTypes: string[] }
  rules: string[]
}

export type AdminDashboard = {
  college: { id: string; name: string; shortName: string } | null
  totals: { records: number; verifiedByStudents: number; admissionYears: number }
  byYear: { admissionYear: number; records: number }[]
  imports: {
    completed: number; partial: number; failed: number; awaitingConfirmation: number
    latest: { id: string; fileName: string; admissionYear: number; status: ImportStatus; createdAt: string; rows: number; inserted: number; updated: number; rejected: number } | null
    recent: { id: string; fileName: string; admissionYear: number; status: ImportStatus; createdAt: string; rows: number }[]
  }
  dataQuality: { missingEmail: number; missingRank: number; missingBranch: number; rejectedRowsInLatestImport: number }
  recentActivity: AuditEntry[]
}

export type StudentRecordRow = {
  id: string
  nucatReference: string
  studentName: string
  admissionYear: number
  nucatRank: number | null
  branch: { id: string; name: string } | null
  admissionStatus: string | null
  verifiedByStudent: boolean
  updatedAt: string
}

export type StudentRecordDetail = StudentRecordRow & {
  officialEmail: string | null
  verifiedAt: string | null
  createdAt: string
  lastImport: { id: string; fileName: string; createdAt: string } | null
}

export type RecordSort = 'nucatReference' | 'studentName' | 'admissionYear' | 'nucatRank' | 'admissionStatus' | 'updatedAt'

export type StudentRecordQuery = {
  search?: string
  admissionYear?: number
  branchId?: string
  status?: string
  sort?: RecordSort
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export type RecordFilters = { admissionYears: number[]; branches: { id: string; name: string }[]; statuses: string[] }

export type RecordUpdate = {
  expectedUpdatedAt: string
  reason: string
  studentName?: string
  nucatRank?: number | null
  allocatedBranchId?: string | null
  admissionStatus?: string | null
  officialEmail?: string | null
}

export type AdmissionYearRow = {
  admissionYear: number
  records: number
  verifiedByStudents: number
  imports: number
  latestImport: { id: string; fileName: string; createdAt: string; status: string } | null
}

// ───────── Super Admin ─────────

export type SuperAdminOverview = {
  collegeAdmins: { total: number; active: number; suspended: number }
  invitations: { pending: number; expired: number }
  institutions: { id: string; name: string; shortName: string }[]
  recentActivity: AuditEntry[]
}

export type CollegeAdminAccount = {
  id: string
  displayName: string | null
  email: string
  status: 'active' | 'suspended'
  college: { id: string; shortName: string } | null
  createdAt: string
  lastActiveAt: string | null
}

export type StaffInvitation = {
  id: string
  displayName: string
  email: string
  state: 'pending' | 'expired' | 'revoked' | 'accepted'
  college: { id: string; shortName: string } | null
  createdAt: string
  expiresAt: string
  invitedBy: string
}

/** A QR placement (where a printed code is used). The payload only identifies the college and location. */
export type QrPlacement = {
  id: string
  institution: { id: string; name: string; shortName: string }
  areaSlug: string
  label: string
  isActive: boolean
  payload: string
  /** What generated images encode: the configured public app URL + /scan?qr=<payload>. */
  scanUrl: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type QrPlacementList = { items: QrPlacement[]; publicAppUrl: string }
export type QrImageFormat = 'png' | 'svg'

/** Read/download operations shared by the College Admin and Super Admin QR pages (different base paths). */
export interface QrCodeReader {
  list(): Promise<QrPlacementList>
  image(id: string, format: QrImageFormat): Promise<Blob>
  download(placement: QrPlacement, format: QrImageFormat): Promise<void>
}

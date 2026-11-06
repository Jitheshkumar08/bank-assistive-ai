import { vi } from 'vitest'
import type { AdminService } from '../services/admin/adminService'
import type { AdminDashboard, ImportDetail, ImportRow, QrPlacement, StudentRecordDetail } from '../services/admin/adminTypes'
import type { SuperAdminService } from '../services/admin/superAdminService'
import type { SessionService, SessionUser } from '../services/auth/sessionService'
import { ServiceError } from '../services/errors'

// Synthetic TEST-ONLY data: invented names and references, never real student records.

export const users: Record<'student' | 'collegeAdmin' | 'superAdmin', SessionUser> = {
  student: { id: 's-1', email: 'student@example.com', displayName: null, role: 'STUDENT' },
  collegeAdmin: { id: 'a-1', email: 'staff@example.com', displayName: 'Test Staff', role: 'COLLEGE_ADMIN' },
  superAdmin: { id: 'r-1', email: 'root@example.com', displayName: 'Test Root', role: 'SUPER_ADMIN' },
}

export const sessionFor = (user: SessionUser | null): SessionService => ({ getSession: vi.fn().mockResolvedValue(user), logout: vi.fn().mockResolvedValue(undefined) })

const unavailable = () => Promise.reject(new ServiceError('UNKNOWN', 'Not mocked in this test.'))

/** QR placements as the backend returns them (synthetic; the payload format is the real one). */
export const qrPlacement = (overrides: Partial<QrPlacement> = {}): QrPlacement => ({
  id: 'q-1', institution: { id: 'nmamit', name: 'NMAM Institute of Technology', shortName: 'NMAMIT' }, areaSlug: 'admissions-desk', label: 'Admission desk', isActive: true,
  payload: 'campusguide:college/nmamit?area=admissions-desk', scanUrl: 'https://campusguide.nitte.example/scan?qr=campusguide%3Acollege%2Fnmamit%3Farea%3Dadmissions-desk',
  createdBy: null, createdAt: '2026-10-22T10:00:00.000Z', updatedAt: '2026-10-22T10:00:00.000Z', ...overrides,
})

export function mockQrReader(items: QrPlacement[] = [qrPlacement()], publicAppUrl = 'https://campusguide.nitte.example') {
  return {
    list: vi.fn().mockResolvedValue({ items, publicAppUrl }),
    image: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' })),
    download: vi.fn().mockResolvedValue(undefined),
  }
}

export function mockAdmin(overrides: Partial<AdminService> = {}): AdminService {
  return {
    dashboard: vi.fn(unavailable), records: vi.fn(unavailable), recordFilters: vi.fn().mockResolvedValue({ admissionYears: [2025, 2024], branches: [{ id: 'b-1', name: 'Test Branch A' }, { id: 'b-2', name: 'Test Branch B' }], statuses: ['Admitted', 'Pending'] }),
    record: vi.fn(unavailable), updateRecord: vi.fn(unavailable), recordHistory: vi.fn().mockResolvedValue({ items: [] }), admissionYears: vi.fn().mockResolvedValue({ items: [] }),
    importColumns: vi.fn().mockResolvedValue({
      columns: [{ field: 'nucatReference', label: 'NUCAT Reference', required: true, description: '', aliases: ['NUCAT Reference'] }, { field: 'studentName', label: 'Student Name', required: true, description: '', aliases: [] }],
      limits: { maxBytes: 5242880, maxRows: 10000, fileTypes: ['.xlsx', '.csv'] }, rules: ['The first non-empty row must contain the column headers.'],
    }),
    previewImport: vi.fn(unavailable), imports: vi.fn(unavailable), importDetail: vi.fn(unavailable), importRows: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
    commitImport: vi.fn(unavailable), cancelImport: vi.fn(unavailable), downloadReport: vi.fn().mockResolvedValue(undefined), downloadTemplate: vi.fn().mockResolvedValue(undefined),
    qrCodes: mockQrReader(),
    ...overrides,
  }
}

export function mockSuperAdmin(overrides: Partial<SuperAdminService> = {}): SuperAdminService {
  return {
    overview: vi.fn().mockResolvedValue({ collegeAdmins: { total: 1, active: 1, suspended: 0 }, invitations: { pending: 1, expired: 0 }, institutions: [{ id: 'nmamit', name: 'NMAM Institute of Technology', shortName: 'NMAMIT' }], recentActivity: [] }),
    collegeAdmins: vi.fn().mockResolvedValue({ accounts: [], invitations: [] }),
    invite: vi.fn(unavailable), resendInvitation: vi.fn(unavailable), revokeInvitation: vi.fn(unavailable), suspend: vi.fn(unavailable), restore: vi.fn(unavailable),
    auditEvents: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
    qrCodes: { ...mockQrReader(), create: vi.fn(unavailable), setActive: vi.fn(unavailable) },
    ...overrides,
  }
}

export const dashboard: AdminDashboard = {
  college: { id: 'nmamit', name: 'NMAM Institute of Technology', shortName: 'NMAMIT' },
  totals: { records: 1234, verifiedByStudents: 56, admissionYears: 2 },
  byYear: [{ admissionYear: 2024, records: 600 }, { admissionYear: 2025, records: 634 }],
  imports: {
    completed: 2, partial: 1, failed: 0, awaitingConfirmation: 0,
    latest: { id: 'imp-1', fileName: 'test_2025.xlsx', admissionYear: 2025, status: 'partial', createdAt: '2026-10-20T10:00:00.000Z', rows: 640, inserted: 634, updated: 0, rejected: 6 },
    recent: [{ id: 'imp-1', fileName: 'test_2025.xlsx', admissionYear: 2025, status: 'partial', createdAt: '2026-10-20T10:00:00.000Z', rows: 640 }],
  },
  dataQuality: { missingEmail: 3, missingRank: 0, missingBranch: 1, rejectedRowsInLatestImport: 6 },
  recentActivity: [{ id: 'e-1', action: 'ADMISSION_IMPORT_COMMITTED', description: 'Imported admission records', actorType: 'ADMIN', actorName: 'Test Staff', entityType: 'AdmissionImportBatch', entityId: 'imp-1', metadata: null, createdAt: '2026-10-20T10:05:00.000Z' }],
}

export const awaitingBatch: ImportDetail = {
  id: 'batch-1', fileName: 'test_2025.csv', admissionYear: 2025, status: 'awaiting_confirmation', importedBy: 'Test Staff',
  createdAt: '2026-10-23T09:00:00.000Z', appliedAt: null, previewExpiresAt: '2026-10-24T09:00:00.000Z', duplicatePolicy: null, failureReason: null,
  counts: { total: 5, valid: 3, invalid: 1, duplicates: 1, new: 2, changed: 1, unchanged: 0, inserted: 0, updated: 0, skipped: 0, rejected: 0 },
  columns: { matched: [{ header: 'NUCAT Reference', field: 'nucatReference', label: 'NUCAT Reference' }], ignored: ['Remarks'], notices: [] },
}

export const importRows: ImportRow[] = [
  { rowNumber: 2, outcome: 'VALID', action: 'INSERT', result: null, nucatReference: 'TST-1', studentName: 'Test Student A', nucatRank: 1, allocatedBranch: 'Test Branch A', admissionStatus: 'Admitted', hasEmail: true, changes: null, messages: [] },
  { rowNumber: 3, outcome: 'INVALID', action: null, result: null, nucatReference: null, studentName: 'Test Student B', nucatRank: null, allocatedBranch: null, admissionStatus: null, hasEmail: false, changes: null, messages: [{ level: 'error', text: 'Missing NUCAT reference.' }] },
]

export const recordDetail: StudentRecordDetail = {
  id: 'rec-1', nucatReference: 'TST-1', studentName: 'Test Student A', admissionYear: 2025, nucatRank: 12, branch: { id: 'b-1', name: 'Test Branch A' },
  admissionStatus: 'Admitted', verifiedByStudent: false, updatedAt: '2026-10-23T08:00:00.000Z', officialEmail: 'a@example.com', verifiedAt: null,
  createdAt: '2026-10-22T08:00:00.000Z', lastImport: { id: 'imp-1', fileName: 'test_2025.xlsx', createdAt: '2026-10-22T08:00:00.000Z' },
}

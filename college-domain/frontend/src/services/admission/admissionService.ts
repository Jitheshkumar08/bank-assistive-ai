import { config } from '../../config'
import { notConnected, ServiceError } from '../errors'
import { apiRequest } from '../http'

/**
 * The final payable amount exactly as calculated by the backend. The UI never computes, adjusts or invents amounts, and
 * receives no breakdown, fee category or scholarship details.
 */
export type FeeDetails =
  | { status: 'CONFIRMED'; /** Whole rupees. */ finalPayableAmount: number }
  | { status: 'REQUIRES_CONFIRMATION' }

/** The signed-in student's own admission details, exactly as returned by the backend from the official records. */
export interface AdmissionDetails {
  studentName: string
  nucatRank: number | null
  allocatedBranch: string | null
  admissionStatus: string | null
  admissionYear: number | null
  fee: FeeDetails
}

/**
 * Identity always comes from the server-side session: the browser sends only the scanned college context (college id
 * and QR area). The backend finds the record by the signed-in account's email and decides what may be shown.
 */
export interface AdmissionService {
  getDetails(context: { collegeId: string; area: string | null }): Promise<AdmissionDetails>
}

const invalidResponse = () => new ServiceError('INVALID_RESPONSE', 'CampusGuide received an incomplete admission record. Please contact the admission office.')
const textOrNull = (field: unknown) => typeof field === 'string' && field.trim() ? field.trim() : null
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Anything that is not a well-formed confirmed amount in rupees is shown as "requires confirmation". */
function parseFee(value: unknown): FeeDetails {
  const fee = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  if (fee.status === 'CONFIRMED' && fee.currency === 'INR' && isAmount(fee.finalPayableAmount)) return { status: 'CONFIRMED', finalPayableAmount: fee.finalPayableAmount }
  return { status: 'REQUIRES_CONFIRMATION' }
}

/** Rejects anything that does not look like a single, well-formed record so nothing unexpected is rendered. */
export function parseAdmissionDetails(value: unknown): AdmissionDetails {
  const record = (value && typeof value === 'object' && 'details' in value ? (value as { details: unknown }).details : null) as Record<string, unknown> | null
  const rank = record?.nucatRank
  const year = record?.admissionYear
  if (!record || typeof record.studentName !== 'string' || !record.studentName.trim()
    || !(rank === null || (typeof rank === 'number' && Number.isInteger(rank) && rank > 0))
    || !(record.allocatedBranch === null || typeof record.allocatedBranch === 'string')
    || !(year === undefined || year === null || (typeof year === 'number' && Number.isInteger(year)))) {
    throw invalidResponse()
  }
  return {
    studentName: record.studentName.trim(),
    nucatRank: rank as number | null,
    allocatedBranch: textOrNull(record.allocatedBranch),
    admissionStatus: textOrNull(record.admissionStatus),
    admissionYear: typeof year === 'number' ? year : null,
    fee: parseFee(record.fee),
  }
}

export const backendPendingAdmissionService: AdmissionService = {
  async getDetails() { throw notConnected('Admission details') },
}

export const httpAdmissionService: AdmissionService = {
  async getDetails({ collegeId, area }) {
    const query = new URLSearchParams({ collegeId, ...(area ? { area } : {}) })
    return parseAdmissionDetails(await apiRequest(`/students/me/admission-details?${query}`, {}, 'Admission details'))
  },
}

export const admissionService: AdmissionService = config.apiBaseUrl ? httpAdmissionService : backendPendingAdmissionService

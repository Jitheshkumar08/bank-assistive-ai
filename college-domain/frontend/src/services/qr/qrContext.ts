import { config } from '../../config'
import { apiRequest } from '../http'
import { ServiceError } from '../errors'

/**
 * Approved CampusGuide QR format (college context only — never identity, results or instructions):
 *
 *   campusguide:college/<college-id>[?area=<area-slug>]
 *
 * Example printed at the NMAMIT admission desk: campusguide:college/nmamit?area=admissions-desk
 *
 * Codes generated in QR Management wrap the same payload in a scan link, <this app>/scan?qr=<payload>, so a phone's own
 * camera app opens CampusGuide. Both forms are accepted; a link is accepted only for this app's own origin.
 */
export const QR_PREFIX = 'campusguide:college/'

export const approvedColleges = {
  nmamit: { collegeName: 'NMAM Institute of Technology', shortName: 'NMAMIT', parent: 'A Constituent College of Nitte (Deemed to be University)' },
} as const

export type CollegeId = keyof typeof approvedColleges

export type CollegeContext = {
  collegeId: CollegeId
  collegeName: string
  area: string | null
  validatedAt: string
  /** 'format' = checked locally against the approved format; 'server' = confirmed by the backend. */
  validatedBy: 'format' | 'server'
}

const invalid = () => new ServiceError('INVALID_QR', 'This isn’t an NMAMIT CampusGuide QR code. Scan the QR code displayed at the NMAMIT admission desk.')
const areaPattern = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Unwraps a scan link (same origin, path /scan, only `qr`) to its payload; any other text is returned as is. */
export function payloadFromScan(raw: string, appOrigin = window.location.origin): string {
  const text = raw.trim()
  if (!/^https?:\/\//i.test(text)) return text
  if (text.length > 300) throw invalid()
  let url: URL
  try { url = new URL(text) } catch { throw invalid() }
  const keys = [...url.searchParams.keys()]
  if (url.origin !== appOrigin || url.pathname !== '/scan' || url.hash || keys.length !== 1 || keys[0] !== 'qr') throw invalid()
  return url.searchParams.get('qr') ?? ''
}

/** Strictly parses a scanned payload (or this app's scan link). Anything else is rejected without echoing it. */
export function parseQrPayload(raw: string): { collegeId: CollegeId; area: string | null } {
  const text = payloadFromScan(raw)
  if (text.length > 120 || !text.startsWith(QR_PREFIX)) throw invalid()
  const [collegePart, query, ...rest] = text.slice(QR_PREFIX.length).split('?')
  if (rest.length || !Object.hasOwn(approvedColleges, collegePart)) throw invalid()
  let area: string | null = null
  if (query !== undefined) {
    const params = new URLSearchParams(query)
    const keys = [...params.keys()]
    if (keys.length !== 1 || keys[0] !== 'area' || !areaPattern.test(params.get('area') ?? '')) throw invalid()
    area = params.get('area')
  }
  return { collegeId: collegePart as CollegeId, area }
}

export interface QrContextService {
  /** Validates a scanned payload and returns the college context it establishes. Does not authenticate anyone. */
  validate(payload: string): Promise<CollegeContext>
}

export const localQrContextService: QrContextService = {
  async validate(payload) {
    const { collegeId, area } = parseQrPayload(payload)
    return { collegeId, area, collegeName: approvedColleges[collegeId].collegeName, validatedAt: new Date().toISOString(), validatedBy: 'format' }
  },
}

/** Checks the format locally first, then asks the backend to confirm the QR is currently active. */
export const httpQrContextService: QrContextService = {
  async validate(scanned) {
    const payload = payloadFromScan(scanned)
    const { collegeId } = parseQrPayload(payload)
    const body = await apiRequest<{ collegeId?: unknown; area?: unknown }>('/qr-context/validate', { method: 'POST', body: JSON.stringify({ payload }) }, 'QR validation')
    if (body.collegeId !== collegeId) throw invalid()
    return {
      collegeId, collegeName: approvedColleges[collegeId].collegeName, validatedAt: new Date().toISOString(), validatedBy: 'server',
      area: typeof body.area === 'string' && areaPattern.test(body.area) ? body.area : null,
    }
  },
}

export const qrContextService: QrContextService = config.apiBaseUrl ? httpQrContextService : localQrContextService

import { HttpStatus, Injectable } from '@nestjs/common'
import { ApiError } from '../common/api-error.js'
import { AppConfig } from '../config/app-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * Approved QR payload: campusguide:college/<institution-id>[?area=<area-slug>] — context only, never identity.
 * Printed codes carry it either as is (codes printed before in-app QR management) or wrapped in a scan link
 * `<FRONTEND_ORIGIN>/scan?qr=<payload>`, so a phone's own camera app opens CampusGuide. Both resolve to the same payload.
 */
const QR_PREFIX = 'campusguide:college/'
export const SCAN_PATH = '/scan'
export const SCAN_PARAM = 'qr'
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/
export const AREA_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_LINK_LENGTH = 300

export type CollegeContext = { collegeId: string; collegeName: string; shortName: string; area: string | null }

const invalidQr = () => new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_QR', 'This isn’t an approved CampusGuide QR code. Scan the QR code displayed at the NMAMIT admission desk.')

/** Strict parser; rejects anything outside the approved format without echoing it back. */
export function parseQrPayload(raw: string): { institutionId: string; area: string | null } {
  const text = raw.trim()
  if (text.length > 120 || !text.startsWith(QR_PREFIX)) throw invalidQr()
  const [idPart, query, ...rest] = text.slice(QR_PREFIX.length).split('?')
  if (rest.length || !ID_PATTERN.test(idPart)) throw invalidQr()
  if (query === undefined) return { institutionId: idPart, area: null }
  const params = new URLSearchParams(query)
  const keys = [...params.keys()]
  const area = params.get('area') ?? ''
  if (keys.length !== 1 || keys[0] !== 'area' || !AREA_PATTERN.test(area)) throw invalidQr()
  return { institutionId: idPart, area }
}

/** The payload for an approved placement (the inverse of parseQrPayload). */
export function buildQrPayload(institutionId: string, area: string | null) {
  return `${QR_PREFIX}${institutionId}${area ? `?area=${area}` : ''}`
}

/** The scan link printed in new QR codes. `publicOrigin` must be the validated FRONTEND_ORIGIN, never a request header. */
export function buildScanLink(publicOrigin: string, payload: string) {
  return `${publicOrigin.replace(/\/$/, '')}${SCAN_PATH}?${SCAN_PARAM}=${encodeURIComponent(payload)}`
}

/**
 * Accepts a raw payload, or a scan link whose origin is exactly this deployment's public origin, path /scan and only
 * the `qr` parameter. Links to any other site or path are rejected (nothing is followed or echoed back).
 */
export function payloadFromScan(raw: string, publicOrigin: string): string {
  const text = raw.trim()
  if (!/^https?:\/\//i.test(text)) return text
  if (text.length > MAX_LINK_LENGTH) throw invalidQr()
  let url: URL
  try { url = new URL(text) } catch { throw invalidQr() }
  const keys = [...url.searchParams.keys()]
  if (url.origin !== new URL(publicOrigin).origin || url.pathname !== SCAN_PATH || url.hash || keys.length !== 1 || keys[0] !== SCAN_PARAM) throw invalidQr()
  return url.searchParams.get(SCAN_PARAM) ?? ''
}

@Injectable()
export class ContextService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfig) {}

  /** Validates a scanned payload (or scan link) against active institutions and approved QR placements. */
  async validate(payload: string): Promise<CollegeContext> {
    const { institutionId, area } = parseQrPayload(payloadFromScan(payload, this.config.frontendOrigin))
    return this.resolve(institutionId, area)
  }

  /**
   * Re-checks a context established earlier by a scan (college id + optional area), so a QR placement or college that
   * was deactivated since the scan no longer opens anything.
   */
  async requireActiveContext(institutionId: string, area: string | null): Promise<CollegeContext> {
    return this.resolve(institutionId, area)
  }

  private async resolve(institutionId: string, area: string | null): Promise<CollegeContext> {
    const institution = await this.prisma.institution.findFirst({ where: { id: institutionId, isActive: true }, select: { id: true, name: true, shortName: true } })
    if (!institution) throw invalidQr()
    if (area) {
      const placement = await this.prisma.institutionQrCode.findFirst({ where: { institutionId, areaSlug: area, isActive: true }, select: { id: true } })
      if (!placement) throw invalidQr()
    }
    return { collegeId: institution.id, collegeName: institution.name, shortName: institution.shortName, area }
  }

  async requireActiveInstitution(institutionId: string) {
    const institution = await this.prisma.institution.findFirst({ where: { id: institutionId, isActive: true }, select: { id: true } })
    if (!institution) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'This college is not available on CampusGuide.')
    return institution
  }
}

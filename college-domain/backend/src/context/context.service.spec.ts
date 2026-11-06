import { ApiError } from '../common/api-error.js'
import { buildQrPayload, buildScanLink, parseQrPayload, payloadFromScan } from './context.service.js'

describe('QR payload format', () => {
  it('accepts the approved format with or without an area', () => {
    expect(parseQrPayload('campusguide:college/nmamit?area=admissions-desk')).toEqual({ institutionId: 'nmamit', area: 'admissions-desk' })
    expect(parseQrPayload(' campusguide:college/nmamit ')).toEqual({ institutionId: 'nmamit', area: null })
  })

  it.each([
    'https://example.com', '{"college_id":"nmamit"}', 'campusguide:college/NMAMIT', 'campusguide:college/nmamit?rank=1',
    'campusguide:college/nmamit?area=desk&name=x', 'campusguide:college/nmamit?area=Desk 1', `campusguide:college/nmamit?area=${'a'.repeat(200)}`,
  ])('rejects %s without echoing it', (payload) => {
    try {
      parseQrPayload(payload)
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).code).toBe('INVALID_QR')
      expect((error as Error).message).not.toContain(payload.slice(0, 30))
      return
    }
    throw new Error('expected rejection')
  })
})

describe('QR scan links', () => {
  const origin = 'https://campusguide.nitte.example'
  const payload = 'campusguide:college/nmamit?area=admissions-desk'

  it('builds the payload and a link on the configured public origin, and reads both forms back', () => {
    expect(buildQrPayload('nmamit', 'admissions-desk')).toBe(payload)
    expect(buildQrPayload('nmamit', null)).toBe('campusguide:college/nmamit')
    const link = buildScanLink(`${origin}/`, payload)
    expect(link).toBe('https://campusguide.nitte.example/scan?qr=campusguide%3Acollege%2Fnmamit%3Farea%3Dadmissions-desk')
    expect(payloadFromScan(link, origin)).toBe(payload)
    expect(parseQrPayload(payloadFromScan(link, origin))).toEqual({ institutionId: 'nmamit', area: 'admissions-desk' })
    // Codes printed before QR Management stay valid unchanged.
    expect(payloadFromScan(` ${payload} `, origin)).toBe(payload)
  })

  it.each([
    'https://evil.example/scan?qr=x', 'http://campusguide.nitte.example/scan?qr=x', 'https://campusguide.nitte.example/other?qr=x',
    'https://campusguide.nitte.example/scan?qr=x&next=y', 'https://campusguide.nitte.example/scan?qr=x#frag', `https://campusguide.nitte.example/scan?qr=${'a'.repeat(400)}`,
  ])('rejects the link %s', (link) => {
    expect(() => payloadFromScan(link, origin)).toThrow(ApiError)
  })
})

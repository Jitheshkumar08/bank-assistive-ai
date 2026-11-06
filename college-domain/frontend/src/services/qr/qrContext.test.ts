import { describe, expect, it } from 'vitest'
import { ServiceError } from '../errors'
import { localQrContextService, parseQrPayload } from './qrContext'

describe('NMAMIT QR payload format', () => {
  it('accepts the approved NMAMIT format with or without a desk area', () => {
    expect(parseQrPayload('campusguide:college/nmamit?area=admissions-desk')).toEqual({ collegeId: 'nmamit', area: 'admissions-desk' })
    expect(parseQrPayload('  campusguide:college/nmamit ')).toEqual({ collegeId: 'nmamit', area: null })
  })

  it.each([
    ['plain text', 'hello'],
    ['a URL', 'https://example.com/campusguide:college/nmamit'],
    ['JSON college context', '{"college_id":"nmamit","area":"desk"}'],
    ['an unapproved college', 'campusguide:college/othercollege'],
    ['prototype keys', 'campusguide:college/toString'],
    ['student data', 'campusguide:college/nmamit?area=desk&rank=12'],
    ['a result injection', 'campusguide:college/nmamit?result=CSE'],
    ['a malformed area', 'campusguide:college/nmamit?area=Admissions Desk'],
    ['a second query', 'campusguide:college/nmamit?area=desk?x=1'],
    ['an oversized payload', `campusguide:college/nmamit?area=${'a'.repeat(200)}`],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseQrPayload(payload)).toThrow(ServiceError)
  })

  it('never echoes the scanned content in its error message', () => {
    try {
      parseQrPayload('campusguide:college/nmamit?secret=STUDENT-123')
      expect.unreachable()
    } catch (error) {
      expect((error as ServiceError).code).toBe('INVALID_QR')
      expect((error as Error).message).not.toContain('STUDENT-123')
    }
  })

  it('establishes only the college context (no identity) from a valid scan', async () => {
    const context = await localQrContextService.validate('campusguide:college/nmamit?area=admissions-desk')
    expect(context).toMatchObject({ collegeId: 'nmamit', collegeName: 'NMAM Institute of Technology', area: 'admissions-desk', validatedBy: 'format' })
    expect(Object.keys(context).sort()).toEqual(['area', 'collegeId', 'collegeName', 'validatedAt', 'validatedBy'])
  })
})

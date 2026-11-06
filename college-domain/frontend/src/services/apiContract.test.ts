import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpAdmissionService } from './admission/admissionService'
import { httpAccountService, httpAuthService } from './auth/authService'
import { httpSessionService } from './auth/sessionService'
import { AuthError } from './auth/types'
import { ServiceError } from './errors'
import { onUnauthenticated } from './http'
import { httpQrContextService } from './qr/qrContext'

vi.mock('../config', () => ({ config: { apiBaseUrl: 'http://api.test/api', campusImageUrl: undefined } }))

// Response shapes copied from the backend's controllers and DTOs (backend/src/**), not from the old proposal.
const student = { id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', email: 'student@example.com', emailVerified: true, createdAt: '2026-10-22T10:00:00.000Z', role: 'STUDENT', displayName: null }
const error = (statusCode: number, code: string, message: string, details?: unknown) => ({ statusCode, code, message, details, requestId: 'r-1' })

const fetchMock = vi.fn<typeof fetch>()
function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

describe('backend API contract', () => {
  it('logs in with POST /auth/login, sends the cookie and returns only the public profile', async () => {
    respond(200, { student, expiresAt: '2026-10-22T22:00:00.000Z' })
    const session = await httpAuthService.login({ email: 'student@example.com', password: 'a long passphrase', rememberMe: true })
    expect(session).toEqual({ user: { id: student.id, email: student.email, role: 'STUDENT' } })
    const call = lastCall()
    expect(call.url).toBe('http://api.test/api/auth/login')
    expect(call.init.method).toBe('POST')
    expect(call.init.credentials).toBe('include')
    expect(call.body).toEqual({ email: 'student@example.com', password: 'a long passphrase', rememberMe: true })
  })

  it.each([
    [401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.'],
    [403, 'EMAIL_NOT_VERIFIED', 'Confirm your email address before signing in.'],
    [429, 'RATE_LIMITED', 'Too many attempts. Try again later.'],
  ])('maps a %i %s login failure to a student-facing AuthError', async (status, code, message) => {
    respond(status, error(status, code, message))
    const failure = httpAuthService.login({ email: 'student@example.com', password: 'x', rememberMe: false })
    await expect(failure).rejects.toBeInstanceOf(AuthError)
    await expect(failure).rejects.toMatchObject({ code, message })
  })

  it('restores the session from GET /auth/me and treats 401 as signed out', async () => {
    respond(200, { student })
    expect(await httpSessionService.getSession()).toEqual({ id: student.id, email: student.email, displayName: null, role: 'STUDENT' })
    expect(lastCall().url).toBe('http://api.test/api/auth/me')
    expect(lastCall().init.credentials).toBe('include')
    respond(401, error(401, 'UNAUTHENTICATED', 'Sign in to continue.'))
    expect(await httpSessionService.getSession()).toBeNull()
  })

  it('reads the role from the server and never upgrades an unknown or missing role', async () => {
    respond(200, { student: { ...student, role: 'COLLEGE_ADMIN', displayName: 'Test Staff' } })
    expect(await httpSessionService.getSession()).toMatchObject({ role: 'COLLEGE_ADMIN', displayName: 'Test Staff' })
    respond(200, { student: { ...student, role: 'ROOT' } })
    expect(await httpSessionService.getSession()).toMatchObject({ role: 'STUDENT' })
    respond(200, { student: { id: student.id, email: student.email } })
    expect(await httpSessionService.getSession()).toMatchObject({ role: 'STUDENT' })
  })

  it('uploads an import as multipart form data with the cookie, without forcing a JSON content type', async () => {
    const { httpAdminService } = await import('./admin/adminService')
    respond(201, { id: 'batch-1' })
    await httpAdminService.previewImport(new File(['a,b'], 'test.csv', { type: 'text/csv' }), 2025)
    const call = fetchMock.mock.calls.at(-1)!
    expect(String(call[0])).toBe('http://api.test/api/admin/admission-imports/preview')
    expect(call[1]!.body).toBeInstanceOf(FormData)
    expect((call[1]!.body as FormData).get('admissionYear')).toBe('2025')
    expect(new Headers(call[1]!.headers).has('Content-Type')).toBe(false)
    expect(call[1]!.credentials).toBe('include')
  })

  it('logs out with POST /auth/logout (204, no body)', async () => {
    respond(204)
    await httpSessionService.logout()
    expect(lastCall()).toMatchObject({ url: 'http://api.test/api/auth/logout', init: { method: 'POST', credentials: 'include' } })
  })

  it('notifies listeners when any request comes back UNAUTHENTICATED (expired session)', async () => {
    const listener = vi.fn()
    const stop = onUnauthenticated(listener)
    respond(401, error(401, 'UNAUTHENTICATED', 'Sign in to continue.'))
    await expect(httpAdmissionService.getDetails({ collegeId: 'nmamit', area: null })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('registers and passes the server’s generic message through unchanged', async () => {
    respond(202, { message: 'If this email can be used, we have sent a message with the next step. Check your inbox.' })
    await expect(httpAccountService.register({ email: 'student@example.com', password: 'a long passphrase' }))
      .resolves.toEqual({ message: 'If this email can be used, we have sent a message with the next step. Check your inbox.' })
    expect(lastCall()).toMatchObject({ url: 'http://api.test/api/auth/register', body: { email: 'student@example.com', password: 'a long passphrase' } })
  })

  it('reports a missing email provider honestly (503 message shown, not a success)', async () => {
    respond(503, error(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'Email delivery is not configured, so no account email can be sent right now.'))
    await expect(httpAccountService.register({ email: 'student@example.com', password: 'a long passphrase' }))
      .rejects.toMatchObject({ code: 'EMAIL_PROVIDER_NOT_CONFIGURED', message: 'Email delivery is not configured, so no account email can be sent right now.' })
  })

  it('hides other 5xx details behind a generic message', async () => {
    respond(500, error(500, 'INTERNAL_ERROR', 'PrismaClientKnownRequestError at 127.0.0.1:5432'))
    const failure = httpAccountService.forgotPassword('student@example.com')
    await expect(failure).rejects.toBeInstanceOf(ServiceError)
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining('Prisma') })
  })

  it('keeps per-field validation details for the forms', async () => {
    respond(400, error(400, 'VALIDATION_FAILED', 'Check the highlighted fields.', [{ field: 'password', messages: ['password must be at least 12 characters'] }]))
    await expect(httpAccountService.register({ email: 'student@example.com', password: 'short' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'password', messages: ['password must be at least 12 characters'] }] })
  })

  it('verifies an email and resets a password with the token from the link', async () => {
    const token = 'A'.repeat(43)
    respond(200, { verified: true })
    await httpAccountService.verifyEmail(token)
    expect(lastCall()).toMatchObject({ url: 'http://api.test/api/auth/verify-email', body: { token } })
    respond(200, { passwordReset: true })
    await httpAccountService.resetPassword({ token, password: 'a new long passphrase' })
    expect(lastCall()).toMatchObject({ url: 'http://api.test/api/auth/reset-password', body: { token, password: 'a new long passphrase' } })
    respond(400, error(400, 'INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired.'))
    await expect(httpAccountService.verifyEmail(token)).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' })
  })

  it('validates a QR payload with POST /qr-context/validate (college context only)', async () => {
    respond(200, { collegeId: 'nmamit', collegeName: 'NMAM Institute of Technology', shortName: 'NMAMIT', area: 'admissions-desk' })
    const context = await httpQrContextService.validate('campusguide:college/nmamit?area=admissions-desk')
    expect(context).toMatchObject({ collegeId: 'nmamit', area: 'admissions-desk', validatedBy: 'server' })
    expect(lastCall()).toMatchObject({ url: 'http://api.test/api/qr-context/validate', body: { payload: 'campusguide:college/nmamit?area=admissions-desk' } })
    expect(JSON.stringify(context)).not.toMatch(/student|email|rank/i)
  })

  it('rejects a foreign QR locally without contacting the backend', async () => {
    await expect(httpQrContextService.validate('https://evil.example/login')).rejects.toMatchObject({ code: 'INVALID_QR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the admission details with GET + session cookie, sending only the scanned college context', async () => {
    // Shape of AdmissionDetailsResponseDto (backend/src/admission/admission.dto.ts).
    const details = {
      studentName: 'Name from the official record', nucatRank: 1523, allocatedBranch: 'Computer Science', admissionStatus: null, admissionYear: 2026,
      fee: { status: 'CONFIRMED', currency: 'INR', finalPayableAmount: 360000 },
    }
    respond(200, { details })
    await expect(httpAdmissionService.getDetails({ collegeId: 'nmamit', area: 'admissions-desk' })).resolves.toMatchObject({ studentName: 'Name from the official record', fee: { status: 'CONFIRMED', finalPayableAmount: 360000 } })
    expect(lastCall()).toMatchObject({ url: 'http://api.test/api/students/me/admission-details?collegeId=nmamit&area=admissions-desk', init: { credentials: 'include' }, body: undefined })
    expect(lastCall().init.method ?? 'GET').toBe('GET')
    expect(new URL(lastCall().url).searchParams.size).toBe(2)
    expect(new URL(lastCall().url).search).not.toMatch(/email|student|reference/i)
    respond(200, { details: { ...details, fee: { status: 'REQUIRES_CONFIRMATION' } } })
    await expect(httpAdmissionService.getDetails({ collegeId: 'nmamit', area: null })).resolves.toMatchObject({ fee: { status: 'REQUIRES_CONFIRMATION' } })
    expect(lastCall().url).toBe('http://api.test/api/students/me/admission-details?collegeId=nmamit')
    respond(404, error(404, 'NO_ADMISSION_RECORD', 'No admission record matches the email address of your CampusGuide account.'))
    await expect(httpAdmissionService.getDetails({ collegeId: 'nmamit', area: null })).rejects.toMatchObject({ code: 'NO_ADMISSION_RECORD' })
    respond(409, error(409, 'AMBIGUOUS_ADMISSION_RECORD', 'More than one admission record matches your account.'))
    await expect(httpAdmissionService.getDetails({ collegeId: 'nmamit', area: null })).rejects.toMatchObject({ code: 'AMBIGUOUS_ADMISSION_RECORD' })
    respond(400, error(400, 'INVALID_QR', 'This isn’t an approved CampusGuide QR code.'))
    await expect(httpAdmissionService.getDetails({ collegeId: 'nmamit', area: 'admissions-desk' })).rejects.toMatchObject({ code: 'INVALID_QR' })
  })
})

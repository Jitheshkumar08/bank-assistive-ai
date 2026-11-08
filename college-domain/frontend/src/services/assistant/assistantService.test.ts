import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../errors'
import { ASSISTANT_TIMEOUT_MS, httpAssistantService, parseStudentContext } from './assistantService'

vi.mock('../../config', () => ({ config: { apiBaseUrl: 'http://api.test/api', campusImageUrl: undefined } }))

// Response shapes copied from the backend (college-domain/backend/src/assistant/assistant.dto.ts). SYNTHETIC values.
const studentContext = {
  verified: true, admissionYear: 2026, rank: 145, category: null, allocatedBranch: 'Synthetic Engineering',
  assignedBatch: null, assignedHall: null, admissionStatus: 'Seat allotted', nextStep: null,
}
const fetchMock = vi.fn<typeof fetch>()
const respond = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : undefined }
}
const request = { message: 'What is my admission status?', history: [], collegeId: 'nmamit', area: 'admissions-desk', language: 'kn' as const, inputMode: 'text' as const }

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('assistant API contract (Phase 6)', () => {
  it('POSTs the question, language and QR context with the session cookie — no identity of its own', async () => {
    respond(200, { text: 'ಉತ್ತರ', language: 'kn', intent: 'admission_status', outcome: 'workflow_result', steps: null, studentContext })
    const reply = await httpAssistantService.send(request)
    const call = lastCall()
    expect(call.url).toBe('http://api.test/api/assistant/messages')
    expect(call.init.method).toBe('POST')
    expect(call.init.credentials).toBe('include')
    expect(call.body).toEqual(request)
    expect(new Headers(call.init.headers).has('Authorization')).toBe(false)
    expect(reply).toEqual({ text: 'ಉತ್ತರ', intent: 'admission_status', outcome: 'workflow_result', steps: null, studentContext })
  })

  it('a reply without student context stays without it', async () => {
    respond(200, { text: 'Answer', intent: 'admission_documents', steps: ['One'], studentContext: null })
    expect(await httpAssistantService.send(request)).toMatchObject({ steps: ['One'], studentContext: null })
  })

  it('drops an unverified or malformed student context instead of rendering it', () => {
    expect(parseStudentContext({ ...studentContext, verified: false })).toBeNull()
    expect(parseStudentContext('rank 1')).toBeNull()
    expect(parseStudentContext({ ...studentContext, rank: '145', admissionYear: 2026.5, allocatedBranch: '  ' }))
      .toMatchObject({ rank: null, admissionYear: null, allocatedBranch: null })
  })

  it('an empty answer is an error, never shown as a reply', async () => {
    respond(200, { text: '   ' })
    await expect(httpAssistantService.send(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('ASSISTANT_UNAVAILABLE keeps the backend’s safe message', async () => {
    respond(503, { statusCode: 503, code: 'ASSISTANT_UNAVAILABLE', message: 'The CampusGuide assistant is not available right now. Please try again in a moment.', requestId: 'r' })
    const error = await httpAssistantService.send(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ code: 'ASSISTANT_UNAVAILABLE', message: expect.stringMatching(/not available right now/) })
  })

  it('an expired session (401) reports UNAUTHENTICATED', async () => {
    respond(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Sign in to continue.', requestId: 'r' })
    await expect(httpAssistantService.send(request)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('a backend that never answers times out with a clear message', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const pending = httpAssistantService.send(request).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(ASSISTANT_TIMEOUT_MS + 1)
    expect(await pending).toMatchObject({ code: 'NETWORK', message: expect.stringMatching(/too long/) })
  })

  it('speech POSTs only the reply text and returns the audio', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([73, 68, 51]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
    const blob = await httpAssistantService.speak!('ಉತ್ತರ')
    expect(blob.type).toBe('audio/mpeg')
    const call = lastCall()
    expect(call.url).toBe('http://api.test/api/assistant/speech')
    expect(call.body).toEqual({ text: 'ಉತ್ತರ' })
    expect(call.init.credentials).toBe('include')
  })
})

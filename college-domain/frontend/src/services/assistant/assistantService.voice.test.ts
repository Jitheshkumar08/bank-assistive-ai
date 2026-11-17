import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../errors'
import { httpAssistantService } from './assistantService'

vi.mock('../../config', () => ({ config: { apiBaseUrl: 'http://api.test/api', campusImageUrl: undefined } }))

/** Phase 7 — spoken questions: POST /assistant/voice-messages (multipart). SYNTHETIC values. */
const fetchMock = vi.fn<typeof fetch>()
const respond = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const recording = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })

describe('assistant voice API contract (Phase 7)', () => {
  it('sends the recording, language and QR context only, as multipart, with the session cookie', async () => {
    respond(200, { text: 'ಉತ್ತರ', intent: 'admission_documents', steps: null, studentContext: null, transcript: 'ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು' })
    const reply = await httpAssistantService.sendVoice!({ audio: recording(), collegeId: 'nmamit', area: 'admissions-desk', language: 'kn' })
    expect(reply).toMatchObject({ text: 'ಉತ್ತರ', transcript: 'ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು', studentContext: null })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://api.test/api/assistant/voice-messages')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    const form = init?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect([...form.keys()].sort()).toEqual(['area', 'audio', 'collegeId', 'language'])
    expect(form.get('language')).toBe('kn')
    expect(form.get('collegeId')).toBe('nmamit')
    expect((form.get('audio') as File).name).toBe('question.webm')
    // The browser sets the multipart boundary itself; no JSON content type is forced.
    expect(new Headers(init?.headers).get('Content-Type')).toBeNull()
  })

  it('omits an absent area', async () => {
    respond(200, { text: 'Answer' })
    await httpAssistantService.sendVoice!({ audio: recording(), collegeId: 'nmamit', area: null, language: 'en' })
    expect((fetchMock.mock.calls[0][1]?.body as FormData).has('area')).toBe(false)
  })

  it('a reply without a transcript keeps it null; an unverified context is dropped', async () => {
    respond(200, { text: 'Answer', transcript: '  ', studentContext: { verified: false, rank: 1 } })
    const reply = await httpAssistantService.sendVoice!({ audio: recording(), collegeId: 'nmamit', language: 'en' })
    expect(reply.transcript ?? null).toBeNull()
    expect(reply.studentContext).toBeNull()
  })

  it('"could not hear" arrives as VOICE_NOT_UNDERSTOOD with the server’s message', async () => {
    respond(422, { code: 'VOICE_NOT_UNDERSTOOD', message: 'Sorry, I could not hear that clearly. Please try again, or type your question.' })
    const error = await httpAssistantService.sendVoice!({ audio: recording(), collegeId: 'nmamit', language: 'en' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ code: 'VOICE_NOT_UNDERSTOOD' })
    expect((error as ServiceError).message).toMatch(/could not hear/)
  })
})

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppConfig } from '../../config/app-config.service.js'
import { EngineCallError, HttpCollegeEngineClient } from './college-engine.client.js'

/**
 * Phase 7 — spoken questions: HttpCollegeEngineClient.turnAudio against a real local HTTP server. The recording goes to
 * the engine's /turn/audio as multipart form data with College's own token, the college domain and the scanned context;
 * the reply (with its transcript) is validated like any College reply.
 */
type Seen = { url?: string; headers: IncomingMessage['headers']; raw: Buffer }
const TOKEN = 'college-test-token-0123456789abcdef-0123'
const RECORDING = Buffer.from('synthetic-webm-recording-bytes')

describe('HttpCollegeEngineClient.turnAudio (Phase 7)', () => {
  let server: Server
  let seen: Seen[]
  let respond: (res: ServerResponse) => void
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        seen.push({ url: req.url, headers: req.headers, raw: Buffer.concat(chunks) })
        respond(res)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)) })
  beforeEach(() => { seen = [] })

  const client = () => new HttpCollegeEngineClient({
    env: { AI_ENGINE_URL: baseUrl, AI_ENGINE_COLLEGE_TOKEN: TOKEN, AI_ENGINE_TIMEOUT_MS: 2000 },
    isProduction: false,
  } as unknown as AppConfig)
  const json = (status: number, payload: unknown) => (res: ServerResponse) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
  }
  const request = { sessionId: 'cg-abc', language: 'kn' as const, institutionId: 'nmamit', area: 'admissions-desk', audio: RECORDING, mimeType: 'audio/webm' }
  const reply = { reply: 'ಉತ್ತರ', domain: 'college', intent: 'admission_documents', outcome: 'answered', steps: null, action: null, transcript: 'ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು' }

  /** The value of one multipart text field, read from the raw body. */
  const field = (raw: Buffer, name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(raw.toString('utf8'))?.[1]

  it('posts the recording and the College context to /turn/audio with College’s own credentials', async () => {
    respond = json(200, reply)
    const result = await client().turnAudio(request)
    expect(result.transcript).toBe('ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು')
    const [call] = seen
    expect(call.url).toBe('/turn/audio')
    expect(call.headers['x-internal-token']).toBe(TOKEN)
    expect(call.headers['x-assistant-domain']).toBe('college')
    expect(String(call.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/)
    expect(field(call.raw, 'session_id')).toBe('cg-abc')
    expect(field(call.raw, 'language')).toBe('kn')
    expect(field(call.raw, 'institution_id')).toBe('nmamit')
    expect(field(call.raw, 'area')).toBe('admissions-desk')
    expect(call.raw.includes(RECORDING)).toBe(true)
    // The file name is generated from the type; nothing from the browser is forwarded.
    expect(call.raw.toString('utf8')).toContain('filename="question.webm"')
    expect(call.raw.toString('utf8')).toContain('Content-Type: audio/webm')
  })

  it('omits the area when there is none, and names the file by its type', async () => {
    respond = json(200, reply)
    await client().turnAudio({ ...request, area: null, mimeType: 'audio/ogg' })
    expect(field(seen[0].raw, 'area')).toBeUndefined()
    expect(seen[0].raw.toString('utf8')).toContain('filename="question.ogg"')
  })

  it('refuses a non-College reply to a spoken question (no Banking fallback)', async () => {
    respond = json(200, { ...reply, domain: 'banking' })
    await expect(client().turnAudio(request)).rejects.toMatchObject({ failure: 'contract' })
  })

  it('reports "could not hear" (422 without a code) and coded refusals distinctly', async () => {
    respond = json(422, { detail: 'I could not hear anything in that recording.' })
    await expect(client().turnAudio(request)).rejects.toMatchObject({ failure: 'refused', status: 422, code: null })
    respond = json(403, { detail: 'x', error: 'domain_forbidden' })
    const error = await client().turnAudio(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineCallError)
    expect(error).toMatchObject({ failure: 'refused', status: 403, code: 'domain_forbidden' })
  })
})

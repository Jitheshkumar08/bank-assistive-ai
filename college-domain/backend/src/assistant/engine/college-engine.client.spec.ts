import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppConfig } from '../../config/app-config.service.js'
import { EngineCallError, HttpCollegeEngineClient } from './college-engine.client.js'

/**
 * Phase 6 — the College backend's engine client against a real local HTTP server: headers, bodies, response
 * validation (including "domain must be college"), refusals and timeouts.
 */
type Seen = { method?: string; url?: string; headers: IncomingMessage['headers']; body: unknown }
const TOKEN = 'college-test-token-0123456789abcdef-0123'

describe('HttpCollegeEngineClient (Phase 6)', () => {
  let server: Server
  let seen: Seen[]
  let respond: (req: IncomingMessage, res: ServerResponse, body: unknown) => void
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null
        seen.push({ method: req.method, url: req.url, headers: req.headers, body })
        respond(req, res, body)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)) })
  beforeEach(() => { seen = [] })

  const client = (over: { token?: string; timeoutMs?: number; production?: boolean } = {}) => new HttpCollegeEngineClient({
    env: { AI_ENGINE_URL: baseUrl, AI_ENGINE_COLLEGE_TOKEN: over.token ?? TOKEN, AI_ENGINE_TIMEOUT_MS: over.timeoutMs ?? 2000 },
    isProduction: over.production ?? false,
  } as unknown as AppConfig)
  const json = (status: number, payload: unknown) => (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
  }
  const turn = { sessionId: 'cg-abc', language: 'kn' as const, text: 'ನನ್ನ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ಏನು', institutionId: 'nmamit', area: 'admissions-desk' }
  const collegeReply = { reply: 'ok', domain: 'college', intent: 'admission_status', outcome: 'action_required', steps: null,
    action: { id: 'abcdefgh12345678', type: 'admission_status', workflow: 'admission status' } }

  it('sends College’s own token, declares the college domain, and only question + language + context', async () => {
    respond = json(200, collegeReply)
    const result = await client().turn(turn)
    expect(result.action?.type).toBe('admission_status')
    expect(seen[0].url).toBe('/turn')
    expect(seen[0].headers['x-internal-token']).toBe(TOKEN)
    expect(seen[0].headers['x-assistant-domain']).toBe('college')
    expect(seen[0].body).toEqual({ session_id: 'cg-abc', language: 'kn', text: turn.text, domain: 'college', context: { institution_id: 'nmamit', area: 'admissions-desk' } })
  })

  it('omits a missing area from the context', async () => {
    respond = json(200, collegeReply)
    await client().turn({ ...turn, area: null })
    expect((seen[0].body as { context: unknown }).context).toEqual({ institution_id: 'nmamit' })
  })

  it('a workflow result carries the action id, the action type and the outcome code only', async () => {
    respond = json(200, { ...collegeReply, action: null, outcome: 'workflow_result' })
    await client().workflowResult('cg-abc', { actionId: 'abcdefgh12345678', actionType: 'admission_status', outcome: 'details_available' })
    expect(seen[0].url).toBe('/sessions/cg-abc/workflow-result')
    expect(seen[0].body).toEqual({ action_id: 'abcdefgh12345678', action_type: 'admission_status', outcome: 'details_available' })
  })

  it('rejects a reply served by another domain (no Banking fallback)', async () => {
    respond = json(200, { ...collegeReply, domain: 'banking' })
    await expect(client().turn(turn)).rejects.toMatchObject({ failure: 'contract' })
  })

  it.each([
    ['no reply', { domain: 'college' }],
    ['a malformed action', { ...collegeReply, action: { id: 'x', type: 'admission_status', workflow: 'w' } }],
    ['non-JSON', 'not json'],
  ])('rejects %s', async (_label, payload) => {
    respond = typeof payload === 'string' ? (_req, res) => { res.writeHead(200).end(payload) } : json(200, payload)
    await expect(client().turn(turn)).rejects.toMatchObject({ failure: 'contract' })
  })

  it('maps engine refusals to a stable code (never the detail text)', async () => {
    respond = json(409, { detail: 'secret internal detail', error: 'action_expired' })
    const error = await client().workflowResult('cg-abc', { actionId: 'abcdefgh12345678', actionType: 'admission_status', outcome: 'details_available' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineCallError)
    expect(error).toMatchObject({ failure: 'refused', status: 409, code: 'action_expired' })
    expect((error as Error).message).not.toContain('secret internal detail')
  })

  it('maps 5xx to server_error and an unreachable engine to unreachable', async () => {
    respond = json(503, { error: 'domain_unavailable' })
    await expect(client().turn(turn)).rejects.toMatchObject({ failure: 'server_error', code: 'domain_unavailable' })
    const offline = new HttpCollegeEngineClient({ env: { AI_ENGINE_URL: 'http://127.0.0.1:1', AI_ENGINE_COLLEGE_TOKEN: TOKEN, AI_ENGINE_TIMEOUT_MS: 2000 }, isProduction: false } as unknown as AppConfig)
    await expect(offline.turn(turn)).rejects.toMatchObject({ failure: 'unreachable' })
  })

  it('times out a slow engine', async () => {
    respond = (_req, res) => { setTimeout(() => res.writeHead(200).end('{}'), 1500) }
    await expect(client({ timeoutMs: 1000 }).turn(turn)).rejects.toMatchObject({ failure: 'timeout' })
  })

  it('never calls the engine without College’s token in production; errors never contain the token', async () => {
    respond = json(200, collegeReply)
    await expect(client({ token: '', production: true }).turn(turn)).rejects.toMatchObject({ failure: 'not_configured' })
    expect(seen).toHaveLength(0)
    respond = json(401, { error: 'not_authorised' })
    const error = await client().turn(turn).catch((e: unknown) => e) as Error
    expect(error.message).not.toContain(TOKEN)
  })

  it('speech returns audio bytes and refuses a non-audio response', async () => {
    respond = (_req, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }).end(Buffer.from('ID3abc')) }
    const speech = await client().synthesize('Hello', 'kn')
    expect(speech).toMatchObject({ contentType: 'audio/mpeg' })
    expect(speech.audio.toString()).toBe('ID3abc')
    expect(seen[0].body).toEqual({ text: 'Hello', language: 'kn' })
    respond = json(200, { reply: 'not audio' })
    await expect(client().synthesize('Hello', 'kn')).rejects.toMatchObject({ failure: 'contract' })
  })
})

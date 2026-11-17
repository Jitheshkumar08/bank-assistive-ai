import type { INestApplication } from '@nestjs/common'
import { ADMIN, assistantTestEnv, cookie, createAssistantApp, InMemoryDb, STUDENT_A, STUDENT_B } from '../../test/support/assistant-world.js'
import { FakeEngine, OUTCOME_REPLIES } from '../../test/support/fake-engine.js'
import { EngineCallError } from './engine/college-engine.client.js'
import { MAX_VOICE_BYTES } from './assistant.service.js'

/**
 * Phase 7 — POST /api/assistant/voice-messages (spoken questions) through the REAL HTTP pipeline: multipart upload,
 * strict validation, session and role guards, QR context check, the admission-status action and speech memory, over
 * an in-memory database and a fake engine. SYNTHETIC data only.
 */
assistantTestEnv()

const RECORDING = Buffer.from('synthetic-webm-recording-bytes')

describe('assistant voice API (Phase 7)', () => {
  let app: INestApplication
  let api: () => import('supertest').Agent
  let db: InMemoryDb
  let engine: FakeEngine

  beforeEach(async () => {
    db = new InMemoryDb()
    engine = new FakeEngine()
    ;({ app, api } = await createAssistantApp(db, engine) as unknown as { app: INestApplication; api: () => import('supertest').Agent })
  })
  afterEach(async () => { await app.close() })

  type Fields = Record<string, string>
  const fields = (over: Fields = {}): Fields => ({ language: 'en', collegeId: 'test-college', area: 'admissions-desk', ...over })
  const speak = (token: string | null, form: Fields = fields(), audio: { data: Buffer; type: string } | null = { data: RECORDING, type: 'audio/webm' }) => {
    let req = api().post('/api/assistant/voice-messages')
    if (token) req = req.set('Cookie', cookie(token))
    for (const [name, value] of Object.entries(form)) req = req.field(name, value)
    if (audio) req = req.attach('audio', audio.data, { filename: 'browser-name.webm', contentType: audio.type })
    return req
  }

  it('a spoken knowledge question is answered, with what was heard, in the requested language', async () => {
    engine.heard = 'What documents do I need?'
    const res = await speak(db.signIn(STUDENT_A), fields({ language: 'kn' }))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ language: 'kn', transcript: 'What documents do I need?', studentContext: null })
    expect(res.body.text.startsWith('[kn]')).toBe(true)
    expect(engine.audioTurns).toEqual([{
      sessionId: expect.stringMatching(/^cg-[0-9a-f]{48}$/), language: 'kn', institutionId: 'test-college', area: 'admissions-desk',
      mimeType: 'audio/webm', size: RECORDING.length,
    }])
  })

  it('a spoken admission-status question runs the same action: the signed-in student’s own record only', async () => {
    engine.heard = 'What is my admission status?'
    const a = await speak(db.signIn(STUDENT_A))
    expect(a.body.text).toBe(OUTCOME_REPLIES.details_available)
    expect(a.body.studentContext).toMatchObject({ verified: true, rank: 145 })
    const b = await speak(db.signIn(STUDENT_B))
    expect(b.body.studentContext).toMatchObject({ rank: 999 })
    expect(JSON.stringify(b.body)).not.toContain('145')
    // Only the action id, type and an outcome code went back to the engine.
    for (const { result } of engine.results) expect(Object.keys(result).sort()).toEqual(['actionId', 'actionType', 'outcome'])
  })

  it('the spoken reply can then be read aloud (it is remembered like a typed reply)', async () => {
    const token = db.signIn(STUDENT_A)
    const res = await speak(token)
    const audio = await api().post('/api/assistant/speech').set('Cookie', cookie(token)).send({ text: res.body.text })
    expect(audio.status).toBe(200)
    expect(audio.headers['content-type']).toMatch(/^audio\/mpeg/)
  })

  it('unauthenticated (401) and staff (403) uploads are refused before the engine is reached', async () => {
    expect((await speak(null)).status).toBe(401)
    expect((await speak(db.signIn(ADMIN))).status).toBe(403)
    expect(engine.audioTurns).toHaveLength(0)
  })

  it('identity or student fields in the form are refused (400), as for typed questions', async () => {
    const token = db.signIn(STUDENT_A)
    for (const forged of [{ email: STUDENT_B.email }, { studentId: STUDENT_B.id }, { rank: '1' }] as Record<string, string>[]) {
      const res = await speak(token, fields(forged))
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('VALIDATION_FAILED')
    }
    expect(engine.audioTurns).toHaveLength(0)
  })

  it('a missing, empty or non-audio upload is refused (400) and never reaches the engine', async () => {
    const token = db.signIn(STUDENT_A)
    expect((await speak(token, fields(), null)).body.code).toBe('VALIDATION_FAILED')
    expect((await speak(token, fields(), { data: Buffer.alloc(0), type: 'audio/webm' })).status).toBe(400)
    const wrongType = await speak(token, fields(), { data: Buffer.from('<html>'), type: 'text/html' })
    expect(wrongType.status).toBe(400)
    expect(wrongType.body.code).toBe('INVALID_FILE')
    expect(engine.audioTurns).toHaveLength(0)
  })

  it('a codec parameter on the type is accepted and dropped', async () => {
    const res = await speak(db.signIn(STUDENT_A), fields(), { data: RECORDING, type: 'audio/webm;codecs=opus' })
    expect(res.status).toBe(200)
    expect(engine.audioTurns[0].mimeType).toBe('audio/webm')
  })

  it('a recording over the limit is refused with 413 FILE_TOO_LARGE', async () => {
    const res = await speak(db.signIn(STUDENT_A), fields(), { data: Buffer.alloc(MAX_VOICE_BYTES + 1, 1), type: 'audio/webm' })
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('FILE_TOO_LARGE')
    expect(engine.audioTurns).toHaveLength(0)
  })

  it('an inactive college / QR placement → 400 INVALID_QR, nothing sent to the engine', async () => {
    const res = await speak(db.signIn(STUDENT_A), fields({ area: 'retired-desk' }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_QR')
    expect(engine.audioTurns).toHaveLength(0)
  })

  it('a recording the engine could not hear → 422 VOICE_NOT_UNDERSTOOD, a message the student can act on', async () => {
    engine.failAudio = new EngineCallError('refused', 422, null)
    const res = await speak(db.signIn(STUDENT_A))
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VOICE_NOT_UNDERSTOOD')
    expect(res.body.message).toMatch(/try again|type/i)
  })

  it.each([
    ['engine down', new EngineCallError('unreachable')],
    ['engine timeout', new EngineCallError('timeout')],
    ['domain refused (coded)', new EngineCallError('refused', 403, 'domain_forbidden')],
    ['context refused (coded 422)', new EngineCallError('refused', 422, 'invalid_context')],
    ['non-College reply', new EngineCallError('contract', 200)],
  ])('%s → 503 ASSISTANT_UNAVAILABLE, no internals', async (_label, failure) => {
    engine.failAudio = failure
    const res = await speak(db.signIn(STUDENT_A))
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('ASSISTANT_UNAVAILABLE')
    expect(JSON.stringify(res.body)).not.toMatch(/engine|token|domain_forbidden|invalid_context/i)
  })

  it('after logout the voice endpoint answers 401', async () => {
    const token = db.signIn(STUDENT_A)
    expect((await speak(token)).status).toBe(200)
    await api().post('/api/auth/logout').set('Cookie', cookie(token)).expect(204)
    expect((await speak(token)).status).toBe(401)
    expect(engine.audioTurns).toHaveLength(1)
  })
})

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { INestApplication } from '@nestjs/common'
import { AssistantService, engineSessionId } from '../../src/assistant/assistant.service.js'
import argon2 from 'argon2'
import { ADMIN, assistantTestEnv, cookie, InMemoryDb, record, STUDENT_A, STUDENT_B, type FakeAccount } from '../support/assistant-world.js'

/**
 * Phase 6 — the complete server-side journey across processes:
 *
 *   (browser request) → College backend [real pipeline, guards, AssistantService, AdmissionService rules,
 *   HttpCollegeEngineClient] → REAL language engine HTTP service [token → domain, context policy, College runtime,
 *   intent detection, admission_status workflow, workflow-result checks] → College backend → (browser response)
 *
 * The engine runs `python -m debugging.college_integration_server` on SYNTHETIC fixtures (institution
 * test-institute-a, fake model, stub Banking runtime). The College database is the in-memory stand-in.
 */
const here = dirname(fileURLToPath(import.meta.url))
const engineDir = resolve(here, '../../../../language_engine')
const python = process.env.ENGINE_PYTHON
  ?? [resolve(engineDir, 'venv/Scripts/python.exe'), resolve(engineDir, 'venv/bin/python')].find((path) => existsSync(path))
const BANK_TOKEN = `bank-int-${'b'.repeat(40)}`
const COLLEGE_TOKEN = `college-int-${'c'.repeat(40)}`
const COLLEGE = 'test-institute-a'
/** Synthetic password for synthetic accounts (in-memory only). */
const PASSWORD = 'synthetic-integration-passphrase'

const freePort = () => new Promise<number>((done, fail) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => done(port))
  }).on('error', fail)
})

describe('College backend ⇄ language engine (cross-process, Phase 6)', () => {
  let engine: ChildProcess
  let engineUrl: string
  let app: INestApplication
  let api: () => import('supertest').Agent
  let db: InMemoryDb

  beforeAll(async () => {
    if (!python) throw new Error(`No engine Python found. Create ${engineDir}/venv or set ENGINE_PYTHON.`)
    const port = await freePort()
    engineUrl = `http://127.0.0.1:${port}`
    engine = spawn(python, ['-m', 'debugging.college_integration_server', '--port', String(port), '--bank-token', BANK_TOKEN, '--college-token', COLLEGE_TOKEN], {
      cwd: engineDir, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`engine did not start:\n${output.slice(-2000)}`)), 110_000)
      const watch = (chunk: Buffer) => {
        output += chunk.toString()
        if (output.includes(`READY ${port}`)) { clearTimeout(timer); done() }
      }
      engine.stdout!.on('data', watch)
      engine.stderr!.on('data', watch)
      engine.on('exit', (code) => { clearTimeout(timer); fail(new Error(`engine exited (${code}):\n${output.slice(-2000)}`)) })
    })

    assistantTestEnv({ AI_ENGINE_URL: engineUrl, AI_ENGINE_COLLEGE_TOKEN: COLLEGE_TOKEN, AI_ENGINE_TIMEOUT_MS: '30000' })
    db = new InMemoryDb([
      record({ id: 'int-a', institutionId: COLLEGE, officialEmail: STUDENT_A.email, studentName: 'Synthetic Integration A', nucatRank: 145, admissionStatus: 'Seat allotted', allocatedBranch: { name: 'Synthetic Engineering' } }),
      record({ id: 'int-b', institutionId: COLLEGE, officialEmail: STUDENT_B.email, studentName: 'Synthetic Integration B', nucatRank: null, nucatReference: 'B', admissionStatus: null }),
    ])
    const hash = await argon2.hash(PASSWORD)
    for (const account of [STUDENT_A, STUDENT_B, ADMIN]) db.registerAccount(account, hash)
    const { createAssistantApp } = await import('../support/assistant-world.js')
    ;({ app, api } = await createAssistantApp(db) as unknown as { app: INestApplication; api: () => import('supertest').Agent })
  })

  afterAll(async () => {
    await app?.close()
    engine?.kill()
  })

  const ask = (account: FakeAccount, message: string, extra: Record<string, unknown> = {}, token = db.signIn(account)) =>
    api().post('/api/assistant/messages').set('Cookie', cookie(token))
      .send({ message, history: [], collegeId: COLLEGE, area: 'admissions-desk', language: 'en', inputMode: 'text', ...extra })

  const engineCall = (path: string, token: string, body: unknown, domain = 'college') => fetch(`${engineUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token, 'X-Assistant-Domain': domain }, body: JSON.stringify(body),
  })

  it('admission status: the engine detects the intent, the backend supplies the record, the engine words the reply', async () => {
    const res = await ask(STUDENT_A, 'What is my admission status?')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      text: 'Your admission details from the official records are shown below.',
      intent: 'admission_status', outcome: 'workflow_result',
      studentContext: { verified: true, rank: 145, allocatedBranch: 'Synthetic Engineering', admissionStatus: 'Seat allotted', assignedBatch: null, assignedHall: null, category: null, nextStep: null },
    })
    expect(JSON.stringify(res.body)).not.toContain('Synthetic Integration A')
  })

  it('rank and admission-hall questions take the same verified path (hall is null: not in the data model)', async () => {
    for (const question of ['What is my rank?', 'Which admission hall should I go to?']) {
      const res = await ask(STUDENT_A, question)
      expect(res.status).toBe(200)
      expect(res.body.intent).toBe('admission_status')
      expect(res.body.studentContext).toMatchObject({ rank: 145, assignedHall: null })
    }
  })

  it('a student with no rank / branch yet gets nulls, never guesses', async () => {
    const res = await ask(STUDENT_B, 'What is my admission status?')
    expect(res.body.studentContext).toMatchObject({ rank: null, allocatedBranch: null, admissionStatus: null })
  })

  it('a student with no record at this college gets the engine’s no_record wording', async () => {
    const res = await ask({ id: 'student-z', email: 'z.student@example.test', role: 'STUDENT', institutionId: null }, 'What is my admission status?')
    expect(res.body.text).toBe("I couldn't find an admission record for the email address of your account. If you applied with a different email address, please contact the admission office.")
    expect(res.body.studentContext).toBeNull()
  })

  it('knowledge questions are answered from the verified-only RAG path, in the selected language', async () => {
    const res = await ask(STUDENT_A, 'What documents do I need for admission?')
    expect(res.status).toBe(200)
    expect(res.body.intent).toBe('admission_documents')
    expect(res.body.studentContext).toBeNull()
    const kn = await ask(STUDENT_A, 'ನನ್ನ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ಏನು', { language: 'kn' })
    expect(kn.body.language).toBe('kn')
    expect(kn.body.text).toMatch(/[ಀ-೿]/) // the engine answered in Kannada script
    expect(kn.body.studentContext).toMatchObject({ rank: 145 })
  })

  it('the Banking token cannot act as College, and College answers never come from Banking', async () => {
    const forged = await engineCall('/turn', BANK_TOKEN, { session_id: 'x', language: 'en', text: 'What is my admission status?', domain: 'college', context: { institution_id: COLLEGE } })
    expect(forged.status).toBe(403)
    const asBanking = await engineCall('/turn', COLLEGE_TOKEN, { session_id: 'x', language: 'en', text: 'deposit' }, 'banking')
    expect(asBanking.status).toBe(403)
  })

  it('the engine refuses a forged student context and record data in a workflow result', async () => {
    const forgedContext = await engineCall('/turn', COLLEGE_TOKEN, { session_id: 'y', language: 'en', text: 'hi', domain: 'college', context: { institution_id: COLLEGE, rank: '1' } })
    expect(forgedContext.status).toBe(422)
    const turn = await (await engineCall('/turn', COLLEGE_TOKEN, { session_id: 'y', language: 'en', text: 'What is my admission status?', domain: 'college', context: { institution_id: COLLEGE } })).json() as { action: { id: string } }
    const withRecord = await engineCall('/sessions/y/workflow-result', COLLEGE_TOKEN, { action_id: turn.action.id, outcome: 'details_available', rank: 1 })
    expect(withRecord.status).toBe(422)
    const wrongType = await engineCall('/sessions/y/workflow-result', COLLEGE_TOKEN, { action_id: turn.action.id, action_type: 'seat_booking', outcome: 'details_available' })
    expect(wrongType.status).toBe(409)
    expect(((await wrongType.json()) as { error: string }).error).toBe('action_mismatch')
    const ok = await engineCall('/sessions/y/workflow-result', COLLEGE_TOKEN, { action_id: turn.action.id, action_type: 'admission_status', outcome: 'no_record' })
    expect(ok.status).toBe(200)
    const replay = await engineCall('/sessions/y/workflow-result', COLLEGE_TOKEN, { action_id: turn.action.id, action_type: 'admission_status', outcome: 'details_available' })
    expect(replay.status).toBe(409)
  })

  it('a different institution in the same engine session is refused (409), never answered', async () => {
    await engineCall('/turn', COLLEGE_TOKEN, { session_id: 'z', language: 'en', text: 'hello', domain: 'college', context: { institution_id: COLLEGE } })
    const other = await engineCall('/turn', COLLEGE_TOKEN, { session_id: 'z', language: 'en', text: 'hello', domain: 'college', context: { institution_id: 'test-institute-b' } })
    expect(other.status).toBe(409)
  })

  // ───────────── The complete student journey (sign-in → QR → question → own record → engine wording) ─────────────

  const signIn = async (email: string) => {
    const res = await api().post('/api/auth/login').send({ email, password: PASSWORD })
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
    const token = setCookie.map((c) => /^cg_session=([^;]+)/.exec(c)?.[1]).find(Boolean)
    return { status: res.status, token }
  }

  it('journey: sign in → scan QR → ask admission status → own record → engine reply', async () => {
    const login = await signIn(STUDENT_A.email)
    expect(login.status).toBe(200)
    expect(login.token).toBeTruthy()
    const qr = await api().post('/api/qr-context/validate').send({ payload: `campusguide:college/${COLLEGE}?area=admissions-desk` })
    expect(qr.status).toBe(200)
    expect(qr.body).toMatchObject({ collegeId: COLLEGE, area: 'admissions-desk' })
    const res = await api().post('/api/assistant/messages').set('Cookie', cookie(login.token!))
      .send({ message: 'What is my admission status?', history: [], collegeId: qr.body.collegeId, area: qr.body.area, language: 'en', inputMode: 'text' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      text: 'Your admission details from the official records are shown below.', intent: 'admission_status',
      studentContext: { verified: true, rank: 145, admissionStatus: 'Seat allotted' },
    })
  })

  it('journey: wrong password and unverified sign-in never reach the assistant', async () => {
    const bad = await api().post('/api/auth/login').send({ email: STUDENT_A.email, password: 'wrong-password-123' })
    expect(bad.status).toBe(401)
    const unknown = await api().post('/api/assistant/messages').send({ message: 'What is my admission status?', collegeId: COLLEGE, language: 'en' })
    expect(unknown.status).toBe(401)
  })

  it('journey: a staff account is refused (403), and student B only ever sees B', async () => {
    const admin = await signIn(ADMIN.email)
    const refused = await api().post('/api/assistant/messages').set('Cookie', cookie(admin.token!)).send({ message: 'What is my admission status?', collegeId: COLLEGE, language: 'en' })
    expect(refused.status).toBe(403)
    const b = await signIn(STUDENT_B.email)
    const res = await api().post('/api/assistant/messages').set('Cookie', cookie(b.token!)).send({ message: 'What is my admission status?', collegeId: COLLEGE, language: 'en' })
    expect(res.body.studentContext).toMatchObject({ rank: null })
    expect(JSON.stringify(res.body)).not.toMatch(/145|Seat allotted/)
  })

  it('journey: an invalid QR is rejected at scan time and at question time', async () => {
    const qr = await api().post('/api/qr-context/validate').send({ payload: `campusguide:college/${COLLEGE}?area=retired-desk` })
    expect(qr.status).toBe(400)
    const login = await signIn(STUDENT_A.email)
    const res = await api().post('/api/assistant/messages').set('Cookie', cookie(login.token!)).send({ message: 'What is my admission status?', collegeId: COLLEGE, area: 'retired-desk', language: 'en' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_QR')
  })

  it('journey: expired and logged-out sessions are refused; the sweep ends the engine conversation', async () => {
    const login = await signIn(STUDENT_A.email)
    await api().post('/api/assistant/messages').set('Cookie', cookie(login.token!)).send({ message: 'What documents do I need?', collegeId: COLLEGE, language: 'en' }).expect(200)
    const session = [...db.sessions.values()].at(-1)!
    const engineId = engineSessionId({ id: STUDENT_A.id, email: STUDENT_A.email, role: 'STUDENT', displayName: null, institutionId: null, sessionId: session.id }, COLLEGE)
    const snapshot = async () => (await (await fetch(`${engineUrl}/sessions/${engineId}/snapshot`, { headers: { 'X-Internal-Token': COLLEGE_TOKEN } })).json()) as { known: boolean }
    expect((await snapshot()).known).toBe(true)

    await api().post('/api/auth/logout').set('Cookie', cookie(login.token!)).expect(204)
    const after = await api().post('/api/assistant/messages').set('Cookie', cookie(login.token!)).send({ message: 'What documents do I need?', collegeId: COLLEGE, language: 'en' })
    expect(after.status).toBe(401)
    expect(await app.get(AssistantService).sweepEndedSessions()).toBeGreaterThanOrEqual(1)
    expect((await snapshot()).known).toBe(false)

    const expired = db.signIn(STUDENT_A, { expired: true })
    const res = await api().post('/api/assistant/messages').set('Cookie', cookie(expired)).send({ message: 'What is my admission status?', collegeId: COLLEGE, language: 'en' })
    expect(res.status).toBe(401)
  })

  it('engine down → 503 ASSISTANT_UNAVAILABLE (no internals)', async () => {
    engine.kill()
    await new Promise((done) => setTimeout(done, 500))
    const res = await ask(STUDENT_A, 'What is my admission status?')
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('ASSISTANT_UNAVAILABLE')
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|fetch/)
  })
})

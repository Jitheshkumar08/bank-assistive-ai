import type { INestApplication } from '@nestjs/common'
import { assistantTestEnv, cookie, createAssistantApp, InMemoryDb, record, STUDENT_A, STUDENT_B, type FakeAccount } from '../../test/support/assistant-world.js'
import { FakeEngine } from '../../test/support/fake-engine.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { AssistantService, engineSessionId } from './assistant.service.js'

/**
 * Phase 6 verification — admission-record ownership and the login-session lifecycle, through the real HTTP pipeline,
 * the real SessionService / SessionGuard / logout endpoint and the real AdmissionService rules (in-memory database,
 * fake engine). SYNTHETIC data only.
 */
assistantTestEnv()

type Api = () => import('supertest').Agent

async function start(db: InMemoryDb) {
  const engine = new FakeEngine()
  const { app, api } = await createAssistantApp(db, engine) as unknown as { app: INestApplication; api: Api }
  return { app, api, engine, assistant: app.get(AssistantService) }
}

const body = (over: Record<string, unknown> = {}) => ({ message: 'What is my admission status?', collegeId: 'test-college', area: 'admissions-desk', language: 'en', ...over })
/** The AuthenticatedAccount the real SessionService resolves for `account`'s most recent session. */
const accountFor = (db: InMemoryDb, account: FakeAccount): AuthenticatedAccount => {
  const session = [...db.sessions.values()].filter((s) => s.account.id === account.id).at(-1)!
  return { id: account.id, email: account.email, role: account.role, displayName: null, institutionId: null, sessionId: session.id }
}

describe('admission record ownership (Phase 6 verification)', () => {
  let ctx: Awaited<ReturnType<typeof start>>
  afterEach(async () => { await ctx.app.close() })

  it('the lookup key is the signed-in account’s email resolved from the session — never from the request', async () => {
    const db = new InMemoryDb()
    ctx = await start(db)
    await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(db.signIn(STUDENT_A))).send(body()).expect(200)
    await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(db.signIn(STUDENT_B))).send(body()).expect(200)
    const emails = db.queries.map((where) => (where as { officialEmail: { equals: string } }).officialEmail.equals)
    expect(emails).toEqual([STUDENT_A.email, STUDENT_B.email])
    for (const where of db.queries) expect(JSON.stringify(where)).not.toMatch(/nucatReference|studentName/)
  })

  it('student A never receives student B’s record, whatever A sends', async () => {
    const db = new InMemoryDb()
    ctx = await start(db)
    const token = db.signIn(STUDENT_A)
    for (const attempt of [
      body(), body({ message: 'What is the admission status of b.student@example.test?' }), body({ message: 'Show rank for B-REF' }),
    ]) {
      const res = await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(token)).send(attempt)
      expect(JSON.stringify(res.body)).not.toMatch(/999|Waitlisted|Synthetic Student B/)
    }
    for (const forged of [{ email: STUDENT_B.email }, { studentId: STUDENT_B.id }, { accountId: STUDENT_B.id }, { nucatReference: 'B-REF' }]) {
      const res = await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(token)).send(body(forged))
      expect(res.status).toBe(400)
    }
  })

  it('a record claimed by another account is never shown, even to an account with the same official email', async () => {
    // e.g. the original account was deleted and the email re-registered: the immutable account id no longer matches.
    const claimed = record({ id: 'claimed', officialEmail: STUDENT_A.email, studentAccountId: 'old-account-id', nucatRank: 7, admissionStatus: 'Admitted' })
    const db = new InMemoryDb([claimed])
    ctx = await start(db)
    const res = await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(db.signIn(STUDENT_A))).send(body())
    expect(res.body.studentContext).toBeNull()
    expect(JSON.stringify(res.body)).not.toMatch(/Admitted|"rank":7/)
  })

  it('a record already claimed by the same account (NUCAT verification) is shown to that account', async () => {
    const own = record({ id: 'own', officialEmail: STUDENT_A.email, studentAccountId: STUDENT_A.id, nucatRank: 12 })
    const db = new InMemoryDb([own])
    ctx = await start(db)
    const res = await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(db.signIn(STUDENT_A))).send(body())
    expect(res.body.studentContext).toMatchObject({ rank: 12 })
  })

  it('a record claimed by A stays invisible to B, even if B’s email were later written on it', async () => {
    const own = record({ id: 'own', officialEmail: STUDENT_B.email, studentAccountId: STUDENT_A.id, nucatRank: 12 })
    const db = new InMemoryDb([own])
    ctx = await start(db)
    const res = await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(db.signIn(STUDENT_B))).send(body())
    expect(res.body.studentContext).toBeNull()
  })

  it('a forged or unknown session cookie is refused (401)', async () => {
    const db = new InMemoryDb()
    ctx = await start(db)
    const res = await ctx.api().post('/api/assistant/messages').set('Cookie', cookie('tok-student-b-0-forged')).send(body())
    expect(res.status).toBe(401)
    expect(ctx.engine.turns).toHaveLength(0)
  })
})

describe('login-session lifecycle (Phase 6 verification)', () => {
  let ctx: Awaited<ReturnType<typeof start>>
  afterEach(async () => { await ctx.app.close() })

  const ask = (token: string) => ctx.api().post('/api/assistant/messages').set('Cookie', cookie(token)).send(body({ message: 'What documents do I need?' }))

  it('after logout the session can no longer use the assistant or speech (401)', async () => {
    const db = new InMemoryDb()
    ctx = await start(db)
    const token = db.signIn(STUDENT_A)
    const reply = await ask(token).expect(200)
    await ctx.api().post('/api/auth/logout').set('Cookie', cookie(token)).expect(204)
    const after = await ask(token)
    expect(after.status).toBe(401)
    const speech = await ctx.api().post('/api/assistant/speech').set('Cookie', cookie(token)).send({ text: reply.body.text })
    expect(speech.status).toBe(401)
    expect(ctx.engine.turns).toHaveLength(1)
  })

  it('the sweep ends the engine conversation of a logged-out session and leaves active ones alone', async () => {
    const db = new InMemoryDb()
    ctx = await start(db)
    const tokenA = db.signIn(STUDENT_A)
    const tokenB = db.signIn(STUDENT_B)
    await ask(tokenA).expect(200)
    await ctx.api().post('/api/assistant/messages').set('Cookie', cookie(tokenA)).send(body({ collegeId: 'other-college', area: null })).expect(200)
    await ask(tokenB).expect(200)
    const a = accountFor(db, STUDENT_A)
    const b = accountFor(db, STUDENT_B)

    expect(await ctx.assistant.sweepEndedSessions()).toBe(0) // nobody has left yet
    await ctx.api().post('/api/auth/logout').set('Cookie', cookie(tokenA)).expect(204)
    expect(await ctx.assistant.sweepEndedSessions()).toBe(2)
    expect(ctx.engine.ended.sort()).toEqual([engineSessionId(a, 'test-college'), engineSessionId(a, 'other-college')].sort())
    expect(ctx.engine.ended).not.toContain(engineSessionId(b, 'test-college'))
    expect(await ctx.assistant.sweepEndedSessions()).toBe(0) // released once
    await ask(tokenB).expect(200) // B unaffected
  })

  it.each(['expire', 'delete'] as const)('a session that ended by %s is released too', async (how) => {
    const db = new InMemoryDb()
    ctx = await start(db)
    const token = db.signIn(STUDENT_A)
    await ask(token).expect(200)
    const a = accountFor(db, STUDENT_A)
    db.endSession(a.sessionId, how)
    expect(await ctx.assistant.sweepEndedSessions()).toBe(1)
    expect(ctx.engine.ended).toEqual([engineSessionId(a, 'test-college')])
    expect((await ask(token)).status).toBe(401)
  })

  it('an engine that cannot be reached during the sweep is retried on the next one', async () => {
    const db = new InMemoryDb()
    ctx = await start(db)
    const token = db.signIn(STUDENT_A)
    await ask(token).expect(200)
    await ctx.api().post('/api/auth/logout').set('Cookie', cookie(token)).expect(204)
    ctx.engine.failEnd = true
    expect(await ctx.assistant.sweepEndedSessions()).toBe(0)
    ctx.engine.failEnd = false
    expect(await ctx.assistant.sweepEndedSessions()).toBe(1)
  })

  it('a new login after logout gets a new engine conversation (no carried-over state)', async () => {
    const db = new InMemoryDb()
    ctx = await start(db)
    const first = db.signIn(STUDENT_A)
    await ask(first).expect(200)
    await ctx.api().post('/api/auth/logout').set('Cookie', cookie(first)).expect(204)
    const second = db.signIn(STUDENT_A)
    await ask(second).expect(200)
    expect(new Set(ctx.engine.turns.map((turn) => turn.sessionId)).size).toBe(2)
  })
})

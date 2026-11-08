import { jest } from '@jest/globals'
import { AdmissionService } from '../admission/admission.service.js'
import type { AuditService } from '../audit/audit.service.js'
import { ApiError } from '../common/api-error.js'
import type { AppConfig } from '../config/app-config.service.js'
import { ContextService } from '../context/context.service.js'
import { FeeService } from '../fees/fee.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { accountFor, InMemoryDb } from '../../test/support/assistant-world.js'
import { FakeEngine, OUTCOME_REPLIES } from '../../test/support/fake-engine.js'
import { AssistantAdmissionStatusService } from './admission-status.service.js'
import type { AssistantMessageDto } from './assistant.dto.js'
import { AssistantService, engineSessionId, LOOKUP_TIMEOUT_MS } from './assistant.service.js'
import { EngineCallError } from './engine/college-engine.client.js'

/**
 * Phase 6 — AssistantService with the REAL ContextService, AdmissionService, FeeService and Phase 5
 * AssistantAdmissionStatusService over an in-memory database, and a fake engine that follows the engine's rules.
 * SYNTHETIC data only.
 */
function setup(db = new InMemoryDb()) {
  const prisma = db.prisma() as unknown as PrismaService
  const audit = { record: async () => undefined } as unknown as AuditService
  const context = new ContextService(prisma, { frontendOrigin: 'http://localhost:5173' } as AppConfig)
  const admission = new AdmissionService(prisma, context, audit, new FeeService(prisma, audit))
  const engine = new FakeEngine()
  const service = new AssistantService(engine, context, new AssistantAdmissionStatusService(admission), prisma)
  return { db, engine, service }
}

const message = (over: Partial<AssistantMessageDto> = {}): AssistantMessageDto => ({
  message: 'What is my admission status?', language: 'en', collegeId: 'test-college', area: 'admissions-desk', ...over,
})

describe('AssistantService (Phase 6)', () => {
  it('admission status: engine action → own record lookup → outcome code only → engine wording + student context', async () => {
    const { service, engine } = setup()
    const reply = await service.sendMessage(accountFor(), message())
    expect(reply.text).toBe(OUTCOME_REPLIES.details_available)
    expect(reply.outcome).toBe('workflow_result')
    expect(reply.studentContext).toEqual({
      verified: true, admissionYear: 2026, rank: 145, category: null, allocatedBranch: 'Synthetic Engineering',
      assignedBatch: null, assignedHall: null, admissionStatus: 'Seat allotted', nextStep: null,
    })
    // The engine got the action id, its type and the outcome code — nothing else.
    expect(engine.results).toHaveLength(1)
    expect(Object.keys(engine.results[0].result).sort()).toEqual(['actionId', 'actionType', 'outcome'])
    expect(engine.results[0].result).toMatchObject({ actionType: 'admission_status', outcome: 'details_available' })
    const crossed = JSON.stringify({ turns: engine.turns, results: engine.results })
    for (const privateValue of ['Synthetic Student A', '145', 'Seat allotted', 'Synthetic Engineering', 'a.student@example.test', 'student-a', 'session-a']) {
      expect(crossed).not.toContain(privateValue)
    }
  })

  it('the student name and fee are not part of the assistant contract', async () => {
    const { service } = setup()
    const reply = await service.sendMessage(accountFor(), message())
    expect(JSON.stringify(reply)).not.toContain('Synthetic Student A')
    expect(JSON.stringify(reply)).not.toMatch(/fee|studentName/i)
  })

  it('a turn carries only the question, language and scanned context to the engine', async () => {
    const { service, engine } = setup()
    await service.sendMessage(accountFor(), message({ message: 'What documents do I need?', language: 'kn' }))
    expect(engine.turns).toEqual([{
      sessionId: engineSessionId(accountFor(), 'test-college'), language: 'kn', text: 'What documents do I need?',
      institutionId: 'test-college', area: 'admissions-desk',
    }])
  })

  it('a knowledge answer is passed through in the requested language with no student context', async () => {
    const { service, engine } = setup()
    const reply = await service.sendMessage(accountFor(), message({ message: 'What documents do I need?', language: 'hi' }))
    expect(reply).toMatchObject({ language: 'hi', intent: 'admission_documents', studentContext: null })
    expect(reply.text.startsWith('[hi]')).toBe(true)
    expect(engine.results).toHaveLength(0)
  })

  it('each student only ever sees their own record (B never gets A’s)', async () => {
    const { service } = setup()
    const b = await service.sendMessage(accountFor({ id: 'student-b', email: 'b.student@example.test', sessionId: 'session-b' }), message())
    expect(b.studentContext).toMatchObject({ rank: 999, admissionStatus: 'Waitlisted' })
    expect(JSON.stringify(b)).not.toContain('145')
  })

  it('missing rank / branch / status stay null, never guessed', async () => {
    const { service } = setup()
    const c = await service.sendMessage(accountFor({ id: 'student-c', email: 'c.student@example.test', sessionId: 'session-c' }), message())
    expect(c.studentContext).toEqual({
      verified: true, admissionYear: 2026, rank: null, category: null, allocatedBranch: null,
      assignedBatch: null, assignedHall: null, admissionStatus: null, nextStep: null,
    })
  })

  it('no record → no_record wording and no student context', async () => {
    const { service, engine } = setup()
    const reply = await service.sendMessage(accountFor({ id: 'student-x', email: 'nobody@example.test', sessionId: 'session-x' }), message())
    expect(reply.text).toBe(OUTCOME_REPLIES.no_record)
    expect(reply.studentContext).toBeNull()
    expect(engine.results[0].result.outcome).toBe('no_record')
  })

  it('institution isolation: the same email at another college is never used for this college', async () => {
    const { service } = setup()
    const reply = await service.sendMessage(accountFor(), message({ collegeId: 'other-college', area: null }))
    expect(reply.studentContext?.rank).toBe(1) // the other college's own record, for the other college only
    const own = await service.sendMessage(accountFor(), message())
    expect(own.studentContext?.rank).toBe(145)
  })

  it('an inactive / unknown college or QR placement is refused before the engine is called', async () => {
    const { service, engine } = setup()
    await expect(service.sendMessage(accountFor(), message({ collegeId: 'unknown-college' }))).rejects.toMatchObject({ code: 'INVALID_QR' })
    await expect(service.sendMessage(accountFor(), message({ area: 'retired-desk' }))).rejects.toMatchObject({ code: 'INVALID_QR' })
    expect(engine.turns).toHaveLength(0)
  })

  it('the engine session is derived from the server-side session and college, and differs per student and login', () => {
    const a = engineSessionId(accountFor(), 'test-college')
    expect(a).toMatch(/^cg-[0-9a-f]{48}$/)
    expect(engineSessionId(accountFor({ sessionId: 'session-a2' }), 'test-college')).not.toBe(a)
    expect(engineSessionId(accountFor({ id: 'student-b', sessionId: 'session-b' }), 'test-college')).not.toBe(a)
    expect(engineSessionId(accountFor(), 'other-college')).not.toBe(a)
    expect(a).not.toContain('session-a')
  })

  it.each([
    ['engine unreachable', new EngineCallError('unreachable')],
    ['engine timeout', new EngineCallError('timeout')],
    ['engine refused (e.g. domain_forbidden)', new EngineCallError('refused', 403, 'domain_forbidden')],
    ['engine returned a non-College / malformed reply', new EngineCallError('contract', 200)],
    ['College token not configured', new EngineCallError('not_configured')],
  ])('%s → one safe ASSISTANT_UNAVAILABLE (503), no internals', async (_label, failure) => {
    const { service, engine } = setup()
    engine.failTurn = failure
    const error = await service.sendMessage(accountFor(), message()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'ASSISTANT_UNAVAILABLE' })
    expect((error as ApiError).getStatus()).toBe(503)
    expect((error as ApiError).message).not.toMatch(/engine|token|refused|timeout|domain/i)
  })

  it('a workflow result the engine refuses (expired / replayed / mismatched) → 503, never the details', async () => {
    const { service, engine } = setup()
    engine.failResult = new EngineCallError('refused', 409, 'action_expired')
    await expect(service.sendMessage(accountFor(), message())).rejects.toMatchObject({ code: 'ASSISTANT_UNAVAILABLE' })
  })

  it('an action this backend does not perform is refused, nothing is looked up', async () => {
    const { service, engine, db } = setup()
    engine.nextTurn = { reply: 'x', domain: 'college', intent: 'x', outcome: 'action_required', steps: null, action: { id: 'action-zzzzzzzz', type: 'seat_booking', workflow: 'seat booking' } }
    await expect(service.sendMessage(accountFor(), message())).rejects.toMatchObject({ code: 'ASSISTANT_UNAVAILABLE' })
    expect(db.queries).toHaveLength(0)
    expect(engine.results).toHaveLength(0)
  })

  it('a database failure is answered as "unavailable" through the engine, never guessed', async () => {
    const db = new InMemoryDb()
    db.failRecordQuery = new Error('connection refused: postgresql://secret')
    const { service, engine } = setup(db)
    const reply = await service.sendMessage(accountFor(), message())
    expect(reply.text).toBe(OUTCOME_REPLIES.unavailable)
    expect(reply.studentContext).toBeNull()
    expect(engine.results[0].result.outcome).toBe('unavailable')
  })

  it('a slow lookup (backend timeout) is answered as "unavailable"', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
    try {
      const db = new InMemoryDb()
      db.recordQueryDelayMs = LOOKUP_TIMEOUT_MS * 10
      const { service, engine } = setup(db)
      const pending = service.sendMessage(accountFor(), message())
      await jest.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS + 10)
      const reply = await pending
      expect(reply.text).toBe(OUTCOME_REPLIES.unavailable)
      expect(engine.results[0].result.outcome).toBe('unavailable')
    } finally {
      jest.useRealTimers()
    }
  })

  it('speech reads only replies this session was given, in their language', async () => {
    const { service, engine } = setup()
    const reply = await service.sendMessage(accountFor(), message({ message: 'What documents do I need?', language: 'kn' }))
    const audio = await service.speak(accountFor(), reply.text)
    expect(audio.contentType).toBe('audio/mpeg')
    expect(engine.spoken).toEqual([{ text: reply.text, language: 'kn' }])
    await expect(service.speak(accountFor(), 'Say anything I type')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(service.speak(accountFor({ id: 'student-b', sessionId: 'session-b' }), reply.text)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

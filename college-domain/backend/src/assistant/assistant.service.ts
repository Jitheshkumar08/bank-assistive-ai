import { createHash } from 'node:crypto'
import { HttpStatus, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ApiError } from '../common/api-error.js'
import { ContextService } from '../context/context.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  ADMISSION_STATUS_ACTION,
  ADMISSION_STATUS_WORKFLOW,
  toStudentContext,
  type AssistantLanguage,
  type AssistantReply,
} from './assistant.contract.js'
import type { AssistantMessageDto } from './assistant.dto.js'
import { AssistantAdmissionStatusService, type AdmissionStatusLookup } from './admission-status.service.js'
import { CollegeEngineClient, EngineCallError, type EngineSpeech } from './engine/college-engine.client.js'

/** A database lookup that takes longer than this is answered as `unavailable` — never guessed. */
export const LOOKUP_TIMEOUT_MS = 8_000

/** How often engine conversations of ended login sessions (logout, revocation, expiry) are released. */
export const SESSION_SWEEP_INTERVAL_MS = 5 * 60_000

const unavailable = () => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'ASSISTANT_UNAVAILABLE',
  'The CampusGuide assistant is not available right now. Please try again in a moment.')

const speechNotAllowed = () => new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Only an assistant reply from this conversation can be read aloud.')

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/**
 * The language engine's session for this visit: derived from the server-side session id (never the cookie token) and
 * the college, so it is unguessable from the browser, different for every student and every login, and a visit to
 * another college starts a separate conversation instead of colliding with the engine's institution binding.
 */
export const engineSessionId = (account: AuthenticatedAccount, collegeId: string) =>
  `cg-${sha256(`campusguide-assistant:${account.sessionId}:${collegeId}`).slice(0, 48)}`

/**
 * The last replies each login session was given, so /assistant/speech reads aloud only real replies (in the language
 * they were given in) and cannot be used as an open text-to-speech proxy. Hashes only; bounded; in memory per instance.
 */
class ServedReplies {
  private readonly bySession = new Map<string, { hash: string; language: AssistantLanguage }[]>()

  constructor(private readonly maxSessions = 2000, private readonly perSession = 12) {}

  remember(sessionId: string, text: string, language: AssistantLanguage) {
    const list = this.bySession.get(sessionId) ?? []
    this.bySession.delete(sessionId) // re-insert: Map order = least recently used first
    list.push({ hash: sha256(text), language })
    this.bySession.set(sessionId, list.slice(-this.perSession))
    while (this.bySession.size > this.maxSessions) this.bySession.delete(this.bySession.keys().next().value!)
  }

  forget(sessionId: string) {
    this.bySession.delete(sessionId)
  }

  languageOf(sessionId: string, text: string): AssistantLanguage | null {
    const hash = sha256(text)
    return [...(this.bySession.get(sessionId) ?? [])].reverse().find((item) => item.hash === hash)?.language ?? null
  }
}

/**
 * Phase 6: the CampusGuide assistant. The College backend is the only caller of the language engine and the source of
 * truth for identity and admission data.
 *
 * 1. The scanned college context is re-checked (inactive college / QR placement → INVALID_QR, the engine is not called).
 * 2. The question goes to the engine with the language and context only (no identity, no record).
 * 3. If the engine asks for the admission status, AssistantAdmissionStatusService looks up the SIGNED-IN student's own
 *    record (the Result page's rules), and only the outcome code goes back to the engine, which words the reply.
 * 4. The browser gets the reply plus, when found, the student's own context straight from this backend.
 */
@Injectable()
export class AssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AssistantService')
  private readonly served = new ServedReplies()
  /** Login session id → engine conversations it opened (one per college). In memory, per instance. */
  private readonly engineSessions = new Map<string, Set<string>>()
  private sweepTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly engine: CollegeEngineClient,
    private readonly context: ContextService,
    private readonly admissionStatus: AssistantAdmissionStatusService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.sweepTimer = setInterval(() => { void this.sweepEndedSessions() }, SESSION_SWEEP_INTERVAL_MS)
    this.sweepTimer.unref()
  }

  onModuleDestroy() {
    clearInterval(this.sweepTimer)
  }

  /**
   * Releases the engine conversations of login sessions that have ended (logout, sign-out-everywhere, expiry, or a
   * deleted session) and the speech memory kept for them. A revoked session can already not reach the assistant
   * (SessionGuard refuses it); this only stops its conversation from lingering in the engine until its idle timeout.
   * Read-only on the database; a failing engine call is retried on the next sweep.
   */
  async sweepEndedSessions(): Promise<number> {
    const ids = [...this.engineSessions.keys()]
    if (!ids.length) return 0
    let live: Set<string>
    try {
      const rows = await this.prisma.studentSession.findMany({ where: { id: { in: ids } }, select: { id: true, revokedAt: true, expiresAt: true } })
      const now = Date.now()
      live = new Set(rows.filter((row) => !row.revokedAt && row.expiresAt.getTime() > now).map((row) => row.id))
    } catch {
      this.logger.warn('Assistant session sweep skipped: sessions could not be read')
      return 0
    }
    let released = 0
    for (const id of ids.filter((sessionId) => !live.has(sessionId))) {
      const pending = [...(this.engineSessions.get(id) ?? [])]
      const results = await Promise.allSettled(pending.map((engineId) => this.engine.endSession(engineId)))
      const failed = pending.filter((_engineId, index) => results[index].status === 'rejected')
      released += pending.length - failed.length
      if (failed.length) this.engineSessions.set(id, new Set(failed))
      else { this.engineSessions.delete(id); this.served.forget(id) }
    }
    return released
  }

  async sendMessage(account: AuthenticatedAccount, message: AssistantMessageDto): Promise<AssistantReply> {
    const area = message.area ?? null
    // Throws INVALID_QR (400) for an inactive or unknown college / placement; nothing reaches the engine.
    await this.context.requireActiveContext(message.collegeId, area)
    const sessionId = engineSessionId(account, message.collegeId)
    const opened = this.engineSessions.get(account.sessionId) ?? new Set<string>()
    this.engineSessions.set(account.sessionId, opened.add(sessionId))

    let response = await this.call(() => this.engine.turn({
      sessionId, language: message.language, text: message.message, institutionId: message.collegeId, area,
    }))

    let lookup: AdmissionStatusLookup | null = null
    if (response.action) {
      const { action } = response
      if (action.type !== ADMISSION_STATUS_ACTION || action.workflow !== ADMISSION_STATUS_WORKFLOW) {
        // Not an action this backend performs: refuse rather than guess (the engine abandons it on the next turn).
        this.logger.warn(`Unexpected engine action type=${/^[a-z_]{1,40}$/.test(action.type) ? action.type : 'invalid'}`)
        throw unavailable()
      }
      lookup = await this.lookup(account, message.collegeId, area)
      response = await this.call(() => this.engine.workflowResult(sessionId, { actionId: action.id, actionType: action.type, outcome: lookup!.outcome }))
      if (response.action) throw unavailable() // a result never asks for another action
    }

    const reply: AssistantReply = {
      text: response.reply,
      language: message.language,
      intent: response.intent ?? null,
      outcome: response.outcome ?? null,
      steps: response.steps?.length ? response.steps : null,
      studentContext: lookup?.outcome === 'details_available' && lookup.details ? toStudentContext(lookup.details) : null,
    }
    this.served.remember(account.sessionId, reply.text, reply.language)
    return reply
  }

  /** Reads a reply this login session was given, in the language it was given in. */
  async speak(account: AuthenticatedAccount, text: string): Promise<EngineSpeech> {
    const language = this.served.languageOf(account.sessionId, text)
    if (!language) throw speechNotAllowed()
    return this.call(() => this.engine.synthesize(text, language === 'tcy' ? 'en' : language))
  }

  /** The admission-status lookup, bounded in time. A slow or failing database is `unavailable`, never a guess. */
  private async lookup(account: AuthenticatedAccount, collegeId: string, area: string | null): Promise<AdmissionStatusLookup> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<AdmissionStatusLookup>((resolve) => {
      timer = setTimeout(() => resolve({ outcome: 'unavailable' }), LOOKUP_TIMEOUT_MS)
    })
    try {
      return await Promise.race([this.admissionStatus.lookup(account, collegeId, area), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Any engine failure (down, timeout, refusal, malformed or non-College reply) becomes one safe 503. */
  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof EngineCallError) throw unavailable()
      this.logger.error(`Assistant engine call failed unexpectedly: ${error instanceof Error ? error.name : 'unknown'}`)
      throw unavailable()
    }
  }
}

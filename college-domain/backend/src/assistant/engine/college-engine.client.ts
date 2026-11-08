import { Injectable, Logger } from '@nestjs/common'
import { AppConfig } from '../../config/app-config.service.js'
import {
  engineErrorSchema,
  engineTurnResponseSchema,
  type EngineTurnRequest,
  type EngineTurnResponse,
  type EngineWorkflowResult,
} from '../assistant.contract.js'

/** Why an engine call did not produce a usable answer. Safe to log: never contains input, output or a token. */
export type EngineFailure = 'not_configured' | 'timeout' | 'unreachable' | 'refused' | 'server_error' | 'contract'

export class EngineCallError extends Error {
  constructor(readonly failure: EngineFailure, readonly status: number | null = null, readonly code: string | null = null) {
    super(`language engine call failed: ${failure}${status ? ` (${status}${code ? ` ${code}` : ''})` : ''}`)
    this.name = 'EngineCallError'
  }
}

export type EngineSpeech = { audio: Buffer; contentType: string }

/** DI token: the assistant service depends on this, tests substitute it. */
export abstract class CollegeEngineClient {
  abstract turn(request: EngineTurnRequest): Promise<EngineTurnResponse>
  abstract workflowResult(sessionId: string, result: EngineWorkflowResult): Promise<EngineTurnResponse>
  abstract synthesize(text: string, language: string): Promise<EngineSpeech>
  /** Ends an engine conversation (logout / revoked or expired session). True when the engine held it. */
  abstract endSession(sessionId: string): Promise<boolean>
}

const AUDIO_TYPES = /^audio\/[a-z0-9.+-]{1,40}$/i
const MAX_AUDIO_BYTES = 5 * 1024 * 1024

/**
 * Backend-to-engine calls for the College domain (Phase 6). Same pattern as the Banking backend's HttpAiEngineClient:
 * loopback HTTP with a per-call timeout and the domain's own shared secret.
 *
 *  - X-Internal-Token = AI_ENGINE_COLLEGE_TOKEN (the engine derives the domain from it; the Banking token is never here)
 *  - X-Assistant-Domain = college, and `domain: "college"` in turn bodies (the engine refuses a mismatch with 403)
 *  - every response is validated (engineTurnResponseSchema), including `domain === "college"`
 *
 * Nothing here logs request text, replies, tokens or student data — only failure categories and status codes.
 */
@Injectable()
export class HttpCollegeEngineClient extends CollegeEngineClient {
  private readonly logger = new Logger('CollegeEngineClient')
  private readonly baseUrl: string
  private readonly token: string
  private readonly timeoutMs: number
  private readonly production: boolean

  constructor(config: AppConfig) {
    super()
    this.baseUrl = config.env.AI_ENGINE_URL.replace(/\/+$/, '')
    this.token = config.env.AI_ENGINE_COLLEGE_TOKEN
    this.timeoutMs = config.env.AI_ENGINE_TIMEOUT_MS
    this.production = config.isProduction
  }

  turn(request: EngineTurnRequest) {
    return this.json('/turn', {
      session_id: request.sessionId,
      language: request.language,
      text: request.text,
      domain: 'college',
      context: { institution_id: request.institutionId, ...(request.area ? { area: request.area } : {}) },
    })
  }

  workflowResult(sessionId: string, result: EngineWorkflowResult) {
    return this.json(`/sessions/${encodeURIComponent(sessionId)}/workflow-result`, {
      action_id: result.actionId,
      action_type: result.actionType,
      outcome: result.outcome,
    })
  }

  async endSession(sessionId: string): Promise<boolean> {
    const response = await this.send(`/sessions/${encodeURIComponent(sessionId)}`, 'DELETE')
    if (!response.ok) throw await this.refusal(response)
    const body = await response.json().catch(() => null) as { removed?: unknown } | null
    return body?.removed === true
  }

  async synthesize(text: string, language: string): Promise<EngineSpeech> {
    const response = await this.post('/tts', { text, language })
    if (!response.ok) throw await this.refusal(response)
    const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
    if (!AUDIO_TYPES.test(contentType)) throw this.fail(new EngineCallError('contract', response.status))
    const audio = Buffer.from(await response.arrayBuffer())
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw this.fail(new EngineCallError('contract', response.status))
    return { audio, contentType }
  }

  private async json(path: string, body: unknown): Promise<EngineTurnResponse> {
    const response = await this.post(path, body)
    if (!response.ok) throw await this.refusal(response)
    const parsed = engineTurnResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw this.fail(new EngineCallError('contract', response.status))
    return parsed.data
  }

  private post(path: string, body: unknown): Promise<Response> {
    return this.send(path, 'POST', body)
  }

  private async send(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<Response> {
    // Production never calls the engine without College's own token (the engine would refuse it anyway).
    if (this.production && !this.token) throw this.fail(new EngineCallError('not_configured'))
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Assistant-Domain': 'college' }
    if (this.token) headers['X-Internal-Token'] = this.token
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // Read structurally: fetch's DOMException may come from another realm, where instanceof Error is false.
      const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
      throw this.fail(new EngineCallError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable'))
    }
  }

  private async refusal(response: Response) {
    const parsed = engineErrorSchema.safeParse(await response.json().catch(() => ({})))
    const code = parsed.success ? parsed.data.error ?? null : null
    return this.fail(new EngineCallError(response.status >= 500 ? 'server_error' : 'refused', response.status, code))
  }

  private fail(error: EngineCallError) {
    this.logger.warn(error.message)
    return error
  }
}

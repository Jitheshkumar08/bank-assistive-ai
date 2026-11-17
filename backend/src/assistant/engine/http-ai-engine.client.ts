import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiEngineClient,
  AiEngineError,
  type EngineAssistance,
  type EngineAudioTurn,
  type EngineInterpreterAudio,
  type EngineInterpreterLanguage,
  type EngineInterpreterTranscript,
  type EngineInterpreterTranslated,
  type EngineInterpreterTranslation,
  type EngineReply,
  type EngineSnapshot,
  type EngineSpeech,
  type EngineSpeechRequest,
  type EngineTextTurn,
  type EngineWorkflow,
} from './ai-engine.client';

type EngineWorkflowPayload = {
  name?: unknown;
  state?: unknown;
  step?: unknown;
  total_steps?: unknown;
} | null;

interface EngineTurnPayload {
  reply?: unknown;
  transcript?: unknown;
  workflow?: EngineWorkflowPayload;
  ended?: unknown;
  detail?: unknown;
}

interface EngineSnapshotPayload {
  known?: unknown;
  ended?: unknown;
  workflow?: EngineWorkflowPayload;
  detail?: unknown;
}

interface EngineAssistancePayload {
  offered?: unknown;
  reason?: unknown;
  field?: unknown;
  prompt_id?: unknown;
  text?: unknown;
  detail?: unknown;
}

/**
 * The engine's workflow snapshot in this API's shape.
 *
 * One mapping for turn replies and snapshots alike, so the two can never
 * translate the engine's state differently.
 */
function toEngineWorkflow(workflow: EngineWorkflowPayload | undefined): EngineWorkflow | null {
  if (!workflow) return null;

  return {
    name: typeof workflow.name === 'string' ? workflow.name : null,
    state: typeof workflow.state === 'string' ? workflow.state : 'none',
    step: typeof workflow.step === 'number' ? workflow.step : null,
    totalSteps: typeof workflow.total_steps === 'number' ? workflow.total_steps : null,
  };
}

interface EngineSpeechErrorPayload {
  detail?: unknown;
  /** Stable failure category, e.g. `synthesis_failed`. Safe to log. */
  error?: unknown;
  request_id?: unknown;
}

/** Only short identifier-shaped values from the engine reach our logs. */
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,64}$/;

function safeToken(value: unknown): string | null {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : null;
}

/**
 * Talks to the FastAPI service over the loopback interface.
 *
 * The engine is not reachable from the browser: this is the only thing
 * that calls it, and it runs behind authentication and session checks
 * that have already happened by the time a request gets here.
 */
@Injectable()
export class HttpAiEngineClient extends AiEngineClient {
  private readonly logger = new Logger(HttpAiEngineClient.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    super();

    this.baseUrl = config.get<string>('AI_ENGINE_URL', 'http://127.0.0.1:8000').replace(/\/+$/, '');
    this.token = config.get<string>('AI_ENGINE_TOKEN', '');
    // Whisper on CPU plus an LLM round trip is comfortably slower than
    // an ordinary API call, so this has its own budget.
    this.timeoutMs = Number(config.get<string>('AI_ENGINE_TIMEOUT_MS', '60000'));
  }

  async sendText(turn: EngineTextTurn): Promise<EngineReply> {
    return this.call('/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader() },
      body: JSON.stringify({
        session_id: turn.sessionId,
        language: turn.language,
        text: turn.text,
      }),
    });
  }

  async sendAudio(turn: EngineAudioTurn): Promise<EngineReply> {
    const form = new FormData();

    form.append('session_id', turn.sessionId);
    form.append('language', turn.language);
    form.append(
      'audio',
      new Blob([new Uint8Array(turn.audio)], { type: turn.mimeType }),
      turn.filename,
    );

    // Content-Type is left to FormData so the multipart boundary is set.
    return this.call('/turn/audio', { method: 'POST', headers: this.authHeader(), body: form });
  }

  /**
   * Fetches spoken audio.
   *
   * Kept apart from call() because the response is binary rather than
   * JSON -- parsing it as JSON would destroy it.
   *
   * Each call carries an X-Request-ID, which the engine logs on every line
   * for this request and echoes back, so one failure can be followed
   * across both services' logs.
   */
  async synthesize(request: EngineSpeechRequest): Promise<EngineSpeech> {
    const requestId = randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          ...this.authHeader(),
        },
        body: JSON.stringify({ text: request.text, language: request.language }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      this.logger.error(
        `Speech service unreachable (requestId=${requestId}): ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );

      throw new AiEngineError(
        aborted
          ? 'The spoken reply took too long. The text answer is still available.'
          : 'The spoken reply is unavailable right now.',
        504,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // A 4xx here means this particular text or language cannot be
      // spoken, which is worth passing on. A 5xx is ours to hide.
      let detail: string | null = null;
      let category: string | null = null;
      let engineRequestId: string | null = null;

      try {
        const body = (await response.json()) as EngineSpeechErrorPayload;
        detail = typeof body.detail === 'string' ? body.detail : null;
        category = safeToken(body.error);
        engineRequestId = safeToken(body.request_id);
      } catch {
        detail = null;
      }

      const isClientProblem = response.status >= 400 && response.status < 500;
      // The category, never the detail text: the category is a fixed
      // identifier, the detail is customer-facing wording.
      this.logger.warn(
        `Speech service returned ${response.status} (category=${category ?? 'unknown'}, requestId=${
          engineRequestId ?? safeToken(response.headers.get('x-request-id')) ?? requestId
        })`,
      );

      throw new AiEngineError(
        isClientProblem && detail ? detail : 'The spoken reply is unavailable right now.',
        isClientProblem ? response.status : 502,
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());

    if (audio.length === 0) {
      throw new AiEngineError('The spoken reply is unavailable right now.', 502);
    }

    return {
      audio,
      // Whatever the engine actually produced, not an assumption.
      contentType: response.headers.get('content-type') ?? 'audio/mpeg',
    };
  }

  /**
   * Releases the engine's conversation for a visit.
   *
   * Kept apart from call(), which expects a turn's `reply` and would
   * treat the engine's `{ removed }` answer as a failure. Throws when the
   * engine is unreachable or refuses; the caller decides that this is
   * best effort.
   */
  async endSession(sessionId: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: this.authHeader(),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AiEngineError(
        `Engine unreachable while ending a session: ${error instanceof Error ? error.name : 'unknown'}`,
        504,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new AiEngineError(`Engine returned ${response.status} while ending a session`, 502);
    }
  }

  private authHeader(): Record<string, string> {
    return this.token ? { 'X-Internal-Token': this.token } : {};
  }

  private async call(path: string, init: RequestInit): Promise<EngineReply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      // The reason is logged for us, never returned: it can contain the
      // engine's host, port and internals.
      this.logger.error(
        `Assistant engine unreachable (${path}): ${error instanceof Error ? error.message : 'unknown'}`,
      );

      throw new AiEngineError(
        aborted
          ? 'The assistant took too long to answer. Please try again.'
          : 'The assistant is temporarily unavailable. Please try again shortly.',
        504,
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: EngineTurnPayload | null = null;

    try {
      payload = (await response.json()) as EngineTurnPayload;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // 4xx from the engine is a problem with this recording -- too
      // large, unintelligible, empty -- and is worth telling the
      // customer. 5xx is ours, and is not.
      const detail = typeof payload?.detail === 'string' ? payload.detail : null;
      const isClientProblem = response.status >= 400 && response.status < 500;

      this.logger.warn(`Assistant engine returned ${response.status} for ${path}`);

      throw new AiEngineError(
        isClientProblem && detail
          ? detail
          : 'The assistant could not handle that request. Please try again.',
        isClientProblem ? response.status : 502,
      );
    }

    if (!payload || typeof payload.reply !== 'string' || payload.reply.trim() === '') {
      this.logger.error(`Assistant engine returned an unusable reply for ${path}`);

      throw new AiEngineError('The assistant did not answer. Please try again.', 502);
    }

    return {
      reply: payload.reply,
      transcript: typeof payload.transcript === 'string' ? payload.transcript : null,
      workflow: toEngineWorkflow(payload.workflow),
      ended: payload.ended === true,
    };
  }

  /**
   * Reads where a visit's conversation stands. The engine changes nothing.
   *
   * Errors follow call()'s rules: a 4xx with a detail -- 409 while a turn
   * is still running -- is passed on as it is; a 5xx or an unusable body
   * becomes 502; unreachable or too slow becomes 504.
   */
  async getSnapshot(sessionId: string): Promise<EngineSnapshot> {
    const path = `/sessions/${encodeURIComponent(sessionId)}/snapshot`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: this.authHeader(),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      this.logger.error(
        `Assistant engine unreachable (snapshot): ${error instanceof Error ? error.message : 'unknown'}`,
      );

      throw new AiEngineError(
        aborted
          ? 'The assistant took too long to answer. Please try again.'
          : 'The assistant is temporarily unavailable. Please try again shortly.',
        504,
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: EngineSnapshotPayload | null = null;

    try {
      payload = (await response.json()) as EngineSnapshotPayload;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : null;
      const isClientProblem = response.status >= 400 && response.status < 500;

      this.logger.warn(`Assistant engine returned ${response.status} for the snapshot`);

      throw new AiEngineError(
        isClientProblem && detail
          ? detail
          : 'The assistant could not report its progress. Please try again.',
        isClientProblem ? response.status : 502,
      );
    }

    // A snapshot is only worth having if it is unambiguous. Anything
    // without an explicit `known` flag is refused rather than read as
    // "no workflow" -- that would erase progress the customer has made.
    if (!payload || typeof payload.known !== 'boolean') {
      this.logger.error('Assistant engine returned an unusable snapshot');

      throw new AiEngineError('The assistant could not report its progress. Please try again.', 502);
    }

    return {
      known: payload.known,
      ended: payload.ended === true,
      // Unknown means unknown: no workflow is reported for a visit the
      // engine does not hold, whatever the body happened to contain.
      workflow: payload.known ? toEngineWorkflow(payload.workflow) : null,
    };
  }

  /**
   * Asks the engine for an offer of help. Errors follow getSnapshot()'s
   * rules: 409 (a turn is running) and other 4xx details pass through, a
   * 5xx or unusable body is 502, unreachable or too slow is 504.
   */
  async requestAssistance(sessionId: string, avoid: string | null): Promise<EngineAssistance> {
    const path = `/sessions/${encodeURIComponent(sessionId)}/assistance`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader() },
        body: JSON.stringify(avoid ? { avoid } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      this.logger.error(
        `Assistant engine unreachable (assistance): ${error instanceof Error ? error.message : 'unknown'}`,
      );

      throw new AiEngineError(
        aborted
          ? 'The assistant took too long to answer. Please try again.'
          : 'The assistant is temporarily unavailable. Please try again shortly.',
        504,
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: EngineAssistancePayload | null = null;

    try {
      payload = (await response.json()) as EngineAssistancePayload;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : null;
      const isClientProblem = response.status >= 400 && response.status < 500;

      this.logger.warn(`Assistant engine returned ${response.status} for assistance`);

      throw new AiEngineError(
        isClientProblem && detail ? detail : 'The assistant could not offer help right now.',
        isClientProblem ? response.status : 502,
      );
    }

    if (!payload || typeof payload.offered !== 'boolean') {
      this.logger.error('Assistant engine returned an unusable assistance answer');

      throw new AiEngineError('The assistant could not offer help right now.', 502);
    }

    const text = typeof payload.text === 'string' && payload.text.trim() ? payload.text : null;

    return {
      // An offer with nothing to say is not an offer.
      offered: payload.offered && text !== null,
      reason: typeof payload.reason === 'string' ? payload.reason : 'unknown',
      field: typeof payload.field === 'string' ? payload.field : null,
      promptId: typeof payload.prompt_id === 'string' ? payload.prompt_id : null,
      text: payload.offered ? text : null,
    };
  }

  async interpreterLanguages(): Promise<EngineInterpreterLanguage[]> {
    const payload = await this.interpreterCall<{ languages?: unknown }>(
      '/interpret/languages',
      { method: 'GET', headers: this.authHeader() },
      'The interpreter is unavailable right now.',
    );

    if (!Array.isArray(payload.languages)) {
      throw new AiEngineError('The interpreter is unavailable right now.', 502);
    }

    return payload.languages.flatMap((item: Record<string, unknown>) =>
      typeof item?.code === 'string' && typeof item?.name === 'string'
        ? [{ code: item.code, name: item.name, speech: item.speech === true }]
        : [],
    );
  }

  async interpretTranscribe(request: EngineInterpreterAudio): Promise<EngineInterpreterTranscript> {
    const form = new FormData();

    form.append('session_id', request.sessionId);
    form.append('language', request.language);
    form.append(
      'audio',
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType }),
      request.filename,
    );

    // Content-Type is left to FormData so the multipart boundary is set.
    const payload = await this.interpreterCall<{ text?: unknown; language?: unknown }>(
      '/interpret/transcribe',
      { method: 'POST', headers: this.authHeader(), body: form },
      'The recording could not be recognised. Please try again.',
    );

    if (typeof payload.text !== 'string' || !payload.text.trim()) {
      throw new AiEngineError('I could not hear anything in that recording.', 422);
    }

    return {
      text: payload.text,
      language: typeof payload.language === 'string' ? payload.language : request.language,
    };
  }

  async interpretTranslate(
    request: EngineInterpreterTranslation,
  ): Promise<EngineInterpreterTranslated> {
    const payload = await this.interpreterCall<{
      translation?: unknown;
      source_language?: unknown;
      target_language?: unknown;
    }>(
      '/interpret/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader() },
        body: JSON.stringify({
          session_id: request.sessionId,
          text: request.text,
          source_language: request.sourceLanguage,
          target_language: request.targetLanguage,
        }),
      },
      'The translation could not be produced. Please try again.',
    );

    if (typeof payload.translation !== 'string' || !payload.translation.trim()) {
      throw new AiEngineError('The translation could not be produced. Please try again.', 502);
    }

    return {
      translation: payload.translation,
      sourceLanguage:
        typeof payload.source_language === 'string' ? payload.source_language : request.sourceLanguage,
      targetLanguage:
        typeof payload.target_language === 'string' ? payload.target_language : request.targetLanguage,
    };
  }

  /**
   * One interpreter request. Errors follow the turn's rules: a 4xx detail
   * passes through (a language not offered, nothing heard), a 5xx becomes
   * `failure` with 502, unreachable or too slow is 504. Neither the words
   * nor the audio are ever logged.
   */
  private async interpreterCall<T>(path: string, init: RequestInit, failure: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      this.logger.error(
        `Assistant engine unreachable (${path}): ${error instanceof Error ? error.message : 'unknown'}`,
      );

      throw new AiEngineError(
        aborted
          ? 'The interpreter took too long. Please try again.'
          : 'The interpreter is temporarily unavailable. Please try again shortly.',
        504,
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: (T & { detail?: unknown }) | null = null;

    try {
      payload = (await response.json()) as T & { detail?: unknown };
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : null;
      const isClientProblem = response.status >= 400 && response.status < 500;

      this.logger.warn(`Assistant engine returned ${response.status} for ${path}`);

      throw new AiEngineError(
        isClientProblem && detail ? detail : failure,
        isClientProblem ? response.status : 502,
      );
    }

    if (!payload) {
      throw new AiEngineError(failure, 502);
    }

    return payload;
  }
}

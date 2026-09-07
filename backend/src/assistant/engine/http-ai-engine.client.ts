import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiEngineClient,
  AiEngineError,
  type EngineAudioTurn,
  type EngineReply,
  type EngineSpeech,
  type EngineSpeechRequest,
  type EngineTextTurn,
} from './ai-engine.client';

interface EngineTurnPayload {
  reply?: unknown;
  transcript?: unknown;
  workflow?: { name?: unknown; state?: unknown; step?: unknown; total_steps?: unknown } | null;
  ended?: unknown;
  detail?: unknown;
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
   */
  async synthesize(request: EngineSpeechRequest): Promise<EngineSpeech> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader() },
        body: JSON.stringify({ text: request.text, language: request.language }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      this.logger.error(
        `Speech service unreachable: ${error instanceof Error ? error.message : 'unknown'}`,
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

      try {
        const body = (await response.json()) as { detail?: unknown };
        detail = typeof body.detail === 'string' ? body.detail : null;
      } catch {
        detail = null;
      }

      const isClientProblem = response.status >= 400 && response.status < 500;
      this.logger.warn(`Speech service returned ${response.status}`);

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

  async endSession(sessionId: string): Promise<void> {
    try {
      await this.call(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: this.authHeader(),
      });
    } catch {
      // Best effort. A conversation the engine keeps a little longer is
      // harmless; it is purged when it goes idle.
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

    const workflow = payload.workflow ?? null;

    return {
      reply: payload.reply,
      transcript: typeof payload.transcript === 'string' ? payload.transcript : null,
      workflow: workflow
        ? {
            name: typeof workflow.name === 'string' ? workflow.name : null,
            state: typeof workflow.state === 'string' ? workflow.state : 'none',
            step: typeof workflow.step === 'number' ? workflow.step : null,
            totalSteps: typeof workflow.total_steps === 'number' ? workflow.total_steps : null,
          }
        : null,
      ended: payload.ended === true,
    };
  }
}

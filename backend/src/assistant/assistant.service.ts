import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../activity/activity.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  AiEngineClient,
  AiEngineError,
  type EngineAssistance,
  type EngineSpeech,
  type EngineWorkflow,
} from './engine/ai-engine.client';

export interface AssistantReplyView {
  reply: string;
  transcript: string | null;
  workflow: EngineWorkflow | null;
  ended: boolean;
}

/**
 * Where the visit's conversation stands, for re-syncing after a turn whose
 * reply never arrived. Status only -- nothing that was said.
 */
export interface AssistantSnapshotView {
  /**
   * False when the assistant holds no conversation for this visit (it was
   * restarted, or the visit went idle). Progress is then unknown and
   * `workflow` is null -- not "no workflow".
   */
  known: boolean;
  /** The customer ended the conversation; no further turns are accepted. */
  ended: boolean;
  /** The same shape every reply carries. Null only when `known` is false. */
  workflow: EngineWorkflow | null;
}

/** Formats a browser could plausibly produce with MediaRecorder. */
const ALLOWED_AUDIO_PREFIXES = ['audio/'];

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly maxAudioBytes: number;

  constructor(
    private readonly sessions: SessionsService,
    private readonly engine: AiEngineClient,
    private readonly activity: ActivityService,
    config: ConfigService,
  ) {
    this.maxAudioBytes = Number(config.get<string>('MAX_AUDIO_BYTES', String(10 * 1024 * 1024)));
  }

  /**
   * Confirms the visit is the caller's own and still open.
   *
   * A session id from the browser is untrusted input. Without this, an
   * authenticated customer could pass someone else's id and talk into
   * their conversation -- including whatever banking task they had
   * halfway finished.
   */
  private async resolveSession(userId: string, sessionId: string) {
    const active = await this.sessions.findActive(userId);

    if (!active || active.id !== sessionId) {
      // One message whether the session belongs to someone else, has
      // ended, or never existed. Distinguishing them would confirm that
      // a given session id is real.
      throw new ForbiddenException('That session is no longer available. Please scan again.');
    }

    return active;
  }

  /**
   * Lets an open assisted activity follow the workflow the engine just
   * reported.
   *
   * The snapshot arrives with every reply, so this costs no extra call
   * and asks the engine nothing new. It is awaited but never allowed to
   * fail a turn: the customer's answer is already on screen.
   *
   * What it records is that a set of INSTRUCTIONS finished. It is not,
   * and must never be read as, confirmation that a payment was made.
   */
  private async followWorkflow(
    userId: string,
    sessionId: string,
    reply: AssistantReplyView,
  ): Promise<void> {
    if (!reply.workflow) return;

    await this.activity.followWorkflow(userId, sessionId, {
      name: reply.workflow.name,
      state: reply.workflow.state,
    });
  }

  async sendText(userId: string, sessionId: string, text: string): Promise<AssistantReplyView> {
    const session = await this.resolveSession(userId, sessionId);

    const reply = await this.deliver(() =>
      this.engine.sendText({
        sessionId: session.id,
        // The language settled when the visit began, from the account's
        // preference. Never hard-coded here.
        language: session.language,
        text,
      }),
    );

    await this.followWorkflow(userId, session.id, reply);

    return reply;
  }

  async sendVoice(
    userId: string,
    sessionId: string,
    audio: { buffer: Buffer; mimetype: string; originalname?: string; size: number },
  ): Promise<AssistantReplyView> {
    const session = await this.resolveSession(userId, sessionId);

    if (!audio.buffer || audio.size === 0) {
      throw new BadRequestException('The recording was empty. Please try again.');
    }

    if (audio.size > this.maxAudioBytes) {
      throw new PayloadTooLargeException('That recording is too long. Please keep it short.');
    }

    const mimeType = (audio.mimetype || '').toLowerCase();

    if (!ALLOWED_AUDIO_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
      throw new BadRequestException('That file is not a supported recording.');
    }

    const reply = await this.deliver(() =>
      this.engine.sendAudio({
        sessionId: session.id,
        language: session.language,
        audio: audio.buffer,
        mimeType,
        // The browser's filename is not trusted for anything but its
        // extension, which the engine uses to pick a decoder.
        filename: `utterance${extensionFor(mimeType)}`,
      }),
    );

    await this.followWorkflow(userId, session.id, reply);

    return reply;
  }

  /**
   * Reads a reply aloud.
   *
   * The language comes from the visit, never from the request: a
   * tampered client must not be able to have a Kannada customer answered
   * in an English voice. Speech is stateless, so this cannot disturb the
   * conversation or its workflow.
   */
  async speak(userId: string, sessionId: string, text: string): Promise<EngineSpeech> {
    const session = await this.resolveSession(userId, sessionId);

    try {
      return await this.engine.synthesize({ text, language: session.language });
    } catch (error) {
      if (error instanceof AiEngineError) {
        throw new HttpException(error.message, error.status);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Unexpected speech failure: ${error instanceof Error ? error.name : 'unknown'}`,
      );

      throw new HttpException('The spoken reply is unavailable right now.', 502);
    }
  }

  /**
   * Reads where the visit's conversation stands, changing nothing.
   *
   * The same ownership check as every turn: a customer can only ever read
   * their own open visit. The engine is the source of truth; nothing here
   * interprets or adjusts what it reports.
   */
  async snapshot(userId: string, sessionId: string): Promise<AssistantSnapshotView> {
    const session = await this.resolveSession(userId, sessionId);

    try {
      return await this.engine.getSnapshot(session.id);
    } catch (error) {
      if (error instanceof AiEngineError) {
        throw new HttpException(error.message, error.status);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Unexpected snapshot failure: ${error instanceof Error ? error.name : 'unknown'}`,
      );

      throw new HttpException('The assistant could not report its progress.', 502);
    }
  }

  /**
   * An offer of help for a customer who has gone quiet on a step.
   *
   * The same ownership check as every turn. The engine decides whether an
   * offer fits and words it in the visit's language; nothing here adds to
   * or reinterprets it, and nothing moves the workflow.
   */
  async assistance(
    userId: string,
    sessionId: string,
    avoid: string | null,
  ): Promise<EngineAssistance> {
    const session = await this.resolveSession(userId, sessionId);

    try {
      return await this.engine.requestAssistance(session.id, avoid);
    } catch (error) {
      if (error instanceof AiEngineError) {
        throw new HttpException(error.message, error.status);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Unexpected assistance failure: ${error instanceof Error ? error.name : 'unknown'}`,
      );

      throw new HttpException('The assistant could not offer help right now.', 502);
    }
  }

  /**
   * Runs an engine call and normalises whatever comes back.
   *
   * Engine failures become ordinary HTTP errors with customer-safe text.
   * Nothing from Python -- message, traceback or path -- reaches the
   * browser.
   */
  private async deliver(
    call: () => Promise<{
      reply: string;
      transcript?: string | null;
      workflow?: EngineWorkflow | null;
      ended?: boolean;
    }>,
  ): Promise<AssistantReplyView> {
    try {
      const result = await call();

      return {
        reply: result.reply,
        transcript: result.transcript ?? null,
        workflow: result.workflow ?? null,
        ended: result.ended === true,
      };
    } catch (error) {
      if (error instanceof AiEngineError) {
        throw new HttpException(error.message, error.status);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Unexpected assistant failure: ${error instanceof Error ? error.name : 'unknown'}`,
      );

      throw new HttpException('The assistant is temporarily unavailable.', 502);
    }
  }
}

/** Maps a recording's MIME type onto the extension Whisper expects. */
export function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return '.m4a';
  if (mimeType.includes('mpeg')) return '.mp3';
  if (mimeType.includes('wav')) return '.wav';

  return '.webm';
}

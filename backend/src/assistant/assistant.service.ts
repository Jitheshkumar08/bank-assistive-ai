import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionsService } from '../sessions/sessions.service';
import {
  AiEngineClient,
  AiEngineError,
  type EngineSpeech,
  type EngineWorkflow,
} from './engine/ai-engine.client';

export interface AssistantReplyView {
  reply: string;
  transcript: string | null;
  workflow: EngineWorkflow | null;
  ended: boolean;
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

  async sendText(userId: string, sessionId: string, text: string): Promise<AssistantReplyView> {
    const session = await this.resolveSession(userId, sessionId);

    return this.deliver(() =>
      this.engine.sendText({
        sessionId: session.id,
        // The language settled when the visit began, from the account's
        // preference. Never hard-coded here.
        language: session.language,
        text,
      }),
    );
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

    return this.deliver(() =>
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
function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return '.m4a';
  if (mimeType.includes('mpeg')) return '.mp3';
  if (mimeType.includes('wav')) return '.wav';

  return '.webm';
}

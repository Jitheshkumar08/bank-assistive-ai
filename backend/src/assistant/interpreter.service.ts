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
import { extensionFor } from './assistant.service';
import {
  AiEngineClient,
  AiEngineError,
  type EngineInterpreterLanguage,
  type EngineInterpreterTranscript,
  type EngineInterpreterTranslated,
  type EngineSpeech,
} from './engine/ai-engine.client';

/**
 * The face-to-face interpreter: a customer and a member of staff talking
 * through the customer's phone, turn by turn.
 *
 * Deliberately separate from AssistantService. Nothing here sends a turn to
 * the conversation, so an interpreted sentence can never be routed as a
 * request -- staff saying "deposit" does not start a deposit. The visit's
 * workflow is left exactly where it was, to be resumed afterwards.
 *
 * Every call is checked against the caller's own open visit, like every
 * assistant call.
 */
@Injectable()
export class InterpreterService {
  private readonly logger = new Logger(InterpreterService.name);
  private readonly maxAudioBytes: number;

  constructor(
    private readonly sessions: SessionsService,
    private readonly engine: AiEngineClient,
    config: ConfigService,
  ) {
    this.maxAudioBytes = Number(config.get<string>('MAX_AUDIO_BYTES', String(10 * 1024 * 1024)));
  }

  /** The same ownership rule, and the same single message, as the assistant. */
  private async resolveSession(userId: string, sessionId: string) {
    const active = await this.sessions.findActive(userId);

    if (!active || active.id !== sessionId) {
      throw new ForbiddenException('That session is no longer available. Please scan again.');
    }

    return active;
  }

  languages(): Promise<EngineInterpreterLanguage[]> {
    return this.engineCall(() => this.engine.interpreterLanguages(), 'languages');
  }

  async transcribe(
    userId: string,
    sessionId: string,
    language: string,
    audio: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<EngineInterpreterTranscript> {
    const session = await this.resolveSession(userId, sessionId);

    if (!audio.buffer || audio.size === 0) {
      throw new BadRequestException('The recording was empty. Please try again.');
    }

    if (audio.size > this.maxAudioBytes) {
      throw new PayloadTooLargeException('That recording is too long. Please keep it short.');
    }

    const mimeType = (audio.mimetype || '').toLowerCase();

    if (!mimeType.startsWith('audio/')) {
      throw new BadRequestException('That file is not a supported recording.');
    }

    return this.engineCall(
      () =>
        this.engine.interpretTranscribe({
          sessionId: session.id,
          language,
          audio: audio.buffer,
          mimeType,
          filename: `utterance${extensionFor(mimeType)}`,
        }),
      'transcription',
    );
  }

  async translate(
    userId: string,
    sessionId: string,
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<EngineInterpreterTranslated> {
    const session = await this.resolveSession(userId, sessionId);

    return this.engineCall(
      () =>
        this.engine.interpretTranslate({
          sessionId: session.id,
          text,
          sourceLanguage,
          targetLanguage,
        }),
      'translation',
    );
  }

  /** Reads a translation aloud in its listener's language. Stateless. */
  async speak(
    userId: string,
    sessionId: string,
    text: string,
    language: string,
  ): Promise<EngineSpeech> {
    await this.resolveSession(userId, sessionId);

    return this.engineCall(() => this.engine.synthesize({ text, language }), 'speech');
  }

  /** Engine failures become ordinary HTTP errors with customer-safe text. */
  private async engineCall<T>(call: () => Promise<T>, what: string): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AiEngineError) {
        throw new HttpException(error.message, error.status);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Unexpected interpreter ${what} failure: ${error instanceof Error ? error.name : 'unknown'}`,
      );

      throw new HttpException('The interpreter is temporarily unavailable.', 502);
    }
  }
}

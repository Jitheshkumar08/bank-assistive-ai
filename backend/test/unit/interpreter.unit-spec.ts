import { ForbiddenException, HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  AiEngineClient,
  AiEngineError,
  type EngineAudioTurn,
  type EngineInterpreterAudio,
  type EngineInterpreterTranslation,
  type EngineReply,
  type EngineSpeech,
  type EngineSpeechRequest,
  type EngineTextTurn,
} from '../../src/assistant/engine/ai-engine.client';
import { HttpAiEngineClient } from '../../src/assistant/engine/http-ai-engine.client';
import { InterpreterService } from '../../src/assistant/interpreter.service';
import type { SessionsService } from '../../src/sessions/sessions.service';

/**
 * The face-to-face interpreter, NestJS side.
 *
 * The service is built directly with a scripted engine and sessions -- no
 * application, database or Python. The HTTP client is exercised against a
 * mocked fetch, so the wire format to the engine is pinned too.
 */

const SESSION_ID = '0b8f6a52-6a8e-4d55-9a8e-3d1c1b2f7a10';
const OTHER_SESSION = '4c1d2e3f-0000-4000-8000-000000000000';

const config = {
  get: (key: string, fallback?: string) =>
    ({ AI_ENGINE_URL: 'http://engine.test', AI_ENGINE_TOKEN: 'secret-token' })[key] ?? fallback,
} as unknown as ConfigService;

class ScriptedEngine extends AiEngineClient {
  readonly turns: unknown[] = [];
  readonly transcribed: EngineInterpreterAudio[] = [];
  readonly translated: EngineInterpreterTranslation[] = [];
  readonly spoken: EngineSpeechRequest[] = [];
  translateError: Error | null = null;

  // A turn reaching the conversation is exactly what must never happen.
  async sendText(turn: EngineTextTurn): Promise<EngineReply> {
    this.turns.push(turn);
    throw new Error('an interpreter call reached the turn pipeline');
  }

  async sendAudio(turn: EngineAudioTurn): Promise<EngineReply> {
    this.turns.push(turn);
    throw new Error('an interpreter call reached the turn pipeline');
  }

  async synthesize(request: EngineSpeechRequest): Promise<EngineSpeech> {
    this.spoken.push(request);
    return { audio: Buffer.from([1, 2, 3]), contentType: 'audio/mpeg' };
  }

  async endSession(): Promise<void> {}

  async interpreterLanguages() {
    return [
      { code: 'kn', name: 'Kannada', speech: true },
      { code: 'ta', name: 'Tamil', speech: false },
    ];
  }

  async interpretTranscribe(request: EngineInterpreterAudio) {
    this.transcribed.push(request);
    return { text: 'Please sign here', language: request.language };
  }

  async interpretTranslate(request: EngineInterpreterTranslation) {
    this.translated.push(request);
    if (this.translateError) throw this.translateError;
    return {
      translation: 'ದಯವಿಟ್ಟು ಇಲ್ಲಿ ಸಹಿ ಮಾಡಿ',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
    };
  }
}

function build(activeSessionId: string | null = SESSION_ID) {
  const engine = new ScriptedEngine();
  const sessions = {
    findActive: jest.fn(async () =>
      activeSessionId ? { id: activeSessionId, language: 'kn' } : null,
    ),
  } as unknown as SessionsService;

  return { engine, service: new InterpreterService(sessions, engine, config) };
}

const audio = (size = 64, mimetype = 'audio/webm;codecs=opus') => ({
  buffer: Buffer.alloc(size),
  mimetype,
  size,
});

describe('InterpreterService', () => {
  it('transcribes in the speaker’s language, without sending a turn', async () => {
    const { engine, service } = build();

    const result = await service.transcribe('u1', SESSION_ID, 'ta', audio());

    expect(result).toEqual({ text: 'Please sign here', language: 'ta' });
    expect(engine.transcribed[0]).toMatchObject({
      sessionId: SESSION_ID,
      language: 'ta',
      mimeType: 'audio/webm;codecs=opus',
      filename: 'utterance.webm',
    });
    expect(engine.turns).toHaveLength(0);
  });

  it('translates in both directions, without sending a turn', async () => {
    const { engine, service } = build();

    await service.translate('u1', SESSION_ID, 'ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಬೇಕು', 'kn', 'ta');
    await service.translate('u1', SESSION_ID, 'Please sign here', 'ta', 'kn');

    expect(engine.translated.map((t) => [t.sourceLanguage, t.targetLanguage])).toEqual([
      ['kn', 'ta'],
      ['ta', 'kn'],
    ]);
    expect(engine.turns).toHaveLength(0);
  });

  it('speaks a translation in its listener’s language, not the visit’s', async () => {
    const { engine, service } = build();

    const speech = await service.speak('u1', SESSION_ID, 'Please sign here', 'en');

    expect(engine.spoken).toEqual([{ text: 'Please sign here', language: 'en' }]);
    expect(speech.contentType).toBe('audio/mpeg');
  });

  it('refuses another customer’s visit, or one that has ended', async () => {
    const { engine, service } = build(OTHER_SESSION);

    await expect(service.transcribe('u1', SESSION_ID, 'kn', audio())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.translate('u1', SESSION_ID, 'hi', 'en', 'kn')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.speak('u1', SESSION_ID, 'hi', 'en')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const ended = build(null);
    await expect(ended.service.translate('u1', SESSION_ID, 'hi', 'en', 'kn')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(engine.transcribed).toHaveLength(0);
  });

  it('rejects an empty, oversized or non-audio upload before the engine', async () => {
    const { engine, service } = build();

    await expect(service.transcribe('u1', SESSION_ID, 'kn', audio(0))).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.transcribe('u1', SESSION_ID, 'kn', audio(11 * 1024 * 1024)),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      service.transcribe('u1', SESSION_ID, 'kn', audio(64, 'text/plain')),
    ).rejects.toMatchObject({ status: 400 });
    expect(engine.transcribed).toHaveLength(0);
  });

  it('passes an engine refusal on with its status and safe message', async () => {
    const { engine, service } = build();
    engine.translateError = new AiEngineError('The interpreter does not support French.', 400);

    const failure = service.translate('u1', SESSION_ID, 'hello', 'en', 'fr');

    await expect(failure).rejects.toBeInstanceOf(HttpException);
    await expect(failure).rejects.toMatchObject({
      status: 400,
      message: 'The interpreter does not support French.',
    });
  });

  it('hides an unexpected failure behind a generic 502', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { engine, service } = build();
    engine.translateError = new TypeError('internal detail');

    await expect(service.translate('u1', SESSION_ID, 'hello', 'en', 'kn')).rejects.toMatchObject({
      status: 502,
      message: 'The interpreter is temporarily unavailable.',
    });
    jest.restoreAllMocks();
  });

  it('lists the engine’s languages, speech flag included', async () => {
    const { service } = build();

    await expect(service.languages()).resolves.toEqual([
      { code: 'kn', name: 'Kannada', speech: true },
      { code: 'ta', name: 'Tamil', speech: false },
    ]);
  });
});

describe('HttpAiEngineClient interpreter calls', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uploads the recording to /interpret/transcribe as multipart', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(json({ text: 'Please sign here', language: 'ta' }));

    const result = await new HttpAiEngineClient(config).interpretTranscribe({
      sessionId: SESSION_ID,
      language: 'ta',
      audio: Buffer.alloc(32),
      mimeType: 'audio/webm',
      filename: 'utterance.webm',
    });

    const [url, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(url).toBe('http://engine.test/interpret/transcribe');
    expect(form.get('session_id')).toBe(SESSION_ID);
    expect(form.get('language')).toBe('ta');
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect((init?.headers as Record<string, string>)['X-Internal-Token']).toBe('secret-token');
    expect(result).toEqual({ text: 'Please sign here', language: 'ta' });
  });

  it('posts JSON to /interpret/translate and maps the answer', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      json({ translation: 'ದಯವಿಟ್ಟು ಇಲ್ಲಿ ಸಹಿ ಮಾಡಿ', source_language: 'en', target_language: 'kn' }),
    );

    const result = await new HttpAiEngineClient(config).interpretTranslate({
      sessionId: SESSION_ID,
      text: 'Please sign here',
      sourceLanguage: 'en',
      targetLanguage: 'kn',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/interpret/translate');
    expect(JSON.parse(String(init?.body))).toEqual({
      session_id: SESSION_ID,
      text: 'Please sign here',
      source_language: 'en',
      target_language: 'kn',
    });
    expect(result).toEqual({
      translation: 'ದಯವಿಟ್ಟು ಇಲ್ಲಿ ಸಹಿ ಮಾಡಿ',
      sourceLanguage: 'en',
      targetLanguage: 'kn',
    });
  });

  it('passes a 4xx detail on, and hides a 5xx one', async () => {
    const client = new HttpAiEngineClient(config);

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(json({ detail: 'I could not hear anything in that recording.' }, 422))
      .mockResolvedValueOnce(json({ detail: 'groq stack trace' }, 502));

    await expect(
      client.interpretTranscribe({
        sessionId: SESSION_ID,
        language: 'kn',
        audio: Buffer.alloc(8),
        mimeType: 'audio/webm',
        filename: 'utterance.webm',
      }),
    ).rejects.toMatchObject({ status: 422, message: 'I could not hear anything in that recording.' });

    await expect(
      client.interpretTranslate({
        sessionId: SESSION_ID,
        text: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'kn',
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'The translation could not be produced. Please try again.',
    });
  });

  it('reads the language list, keeping only well-formed entries', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json({
        languages: [
          { code: 'kn', name: 'Kannada', speech: true },
          { code: 'ta', name: 'Tamil', speech: false },
          { bogus: true },
        ],
      }),
    );

    await expect(new HttpAiEngineClient(config).interpreterLanguages()).resolves.toEqual([
      { code: 'kn', name: 'Kannada', speech: true },
      { code: 'ta', name: 'Tamil', speech: false },
    ]);
  });
});

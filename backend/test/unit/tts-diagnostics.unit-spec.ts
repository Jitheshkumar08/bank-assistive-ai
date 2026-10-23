import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AiEngineError } from '../../src/assistant/engine/ai-engine.client';
import { HttpAiEngineClient } from '../../src/assistant/engine/http-ai-engine.client';

/**
 * Phase 1: a failed spoken reply can be traced.
 *
 * The engine's /tts refusal carries a stable category and the request id
 * this client sent. These assert both reach the log -- and that neither the
 * reply text nor the customer-facing detail does -- while what the browser
 * receives is exactly what it received before.
 */

const config = {
  get: (key: string, fallback?: string) =>
    ({ AI_ENGINE_URL: 'http://engine.test', AI_ENGINE_TOKEN: 'secret-token' })[key] ?? fallback,
} as unknown as ConfigService;

const REPLY = 'Deposit 98765 rupees into account 1234567890.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function speak() {
  return new HttpAiEngineClient(config).synthesize({ text: REPLY, language: 'kn' });
}

describe('HttpAiEngineClient.synthesize diagnostics', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends a request id with the token, and returns the audio unchanged', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    );

    const speech = await speak();

    const [url, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(url).toBe('http://engine.test/tts');
    expect(headers['X-Internal-Token']).toBe('secret-token');
    expect(headers['X-Request-ID']).toMatch(UUID);
    expect(JSON.parse(String(init?.body))).toEqual({ text: REPLY, language: 'kn' });
    expect(speech.contentType).toBe('audio/mpeg');
    expect(speech.audio.length).toBe(4);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs the engine's category and request id, and passes the safe detail on", async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json(
        {
          detail: 'The spoken reply could not be produced.',
          error: 'synthesis_failed',
          request_id: 'req-abc123',
        },
        422,
      ),
    );

    const failure = speak();

    await expect(failure).rejects.toBeInstanceOf(AiEngineError);
    await expect(failure).rejects.toMatchObject({
      status: 422,
      message: 'The spoken reply could not be produced.',
    });
    expect(warn).toHaveBeenCalledWith(
      'Speech service returned 422 (category=synthesis_failed, requestId=req-abc123)',
    );
  });

  it('falls back to its own request id and an unknown category for an unstructured 422', async () => {
    // FastAPI's default validation body: detail is a list, no category.
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(json({ detail: [{ loc: ['body', 'text'], type: 'missing' }] }, 422));

    await expect(speak()).rejects.toMatchObject({
      status: 422,
      message: 'The spoken reply is unavailable right now.',
    });

    const sent = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['X-Request-ID'];
    expect(warn).toHaveBeenCalledWith(
      `Speech service returned 422 (category=unknown, requestId=${sent})`,
    );
  });

  it('never logs a category or id that is not identifier-shaped', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json({ detail: 'x', error: 'bad\ninjected line', request_id: 'a b' }, 422, {
        'X-Request-ID': 'from-header-1',
      }),
    );

    await expect(speak()).rejects.toBeInstanceOf(AiEngineError);
    expect(warn).toHaveBeenCalledWith(
      'Speech service returned 422 (category=unknown, requestId=from-header-1)',
    );
  });

  it('keeps reply text and customer wording out of the log', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json(
        { detail: 'There is nothing to read out.', error: 'empty_after_cleaning', request_id: 'r1' },
        422,
      ),
    );

    await expect(speak()).rejects.toBeInstanceOf(AiEngineError);

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('category=empty_after_cleaning');
    expect(logged).not.toContain('98765');
    expect(logged).not.toContain('1234567890');
    expect(logged).not.toContain('nothing to read out');
  });

  it('hides a 5xx from the browser but still logs its category', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(json({ detail: 'internal', error: 'synthesis_failed', request_id: 'r5' }, 500));

    await expect(speak()).rejects.toMatchObject({
      status: 502,
      message: 'The spoken reply is unavailable right now.',
    });
    expect(warn).toHaveBeenCalledWith(
      'Speech service returned 500 (category=synthesis_failed, requestId=r5)',
    );
  });

  it('logs the request id when the engine cannot be reached', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(speak()).rejects.toMatchObject({ status: 504 });

    const sent = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['X-Request-ID'];
    expect(error).toHaveBeenCalledWith(
      `Speech service unreachable (requestId=${sent}): fetch failed`,
    );
  });
});

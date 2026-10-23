import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpAssistantClient } from './httpAssistantClient';
import { setTokenReader, setUnauthorizedHandler } from '@/api/client';
import { ApiError } from '@/types/api';
import type { AssistantRequest } from '@/types/assistant';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const BASE_REQUEST: Omit<AssistantRequest, 'input'> = {
  sessionId: 'sess-1',
  language: 'kn',
  context: { branchCode: 'BR001' },
};

describe('HttpAssistantClient', () => {
  const client = new HttpAssistantClient();

  beforeEach(() => {
    setTokenReader(() => 'a-token');
    setUnauthorizedHandler(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('a typed turn', () => {
    it('posts the message to the assistant endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { reply: 'Please take a withdrawal slip.' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await client.sendMessage({
        ...BASE_REQUEST,
        input: { type: 'text', text: 'I want to withdraw money' },
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/assistant\/message$/);
      expect(JSON.parse(init.body)).toEqual({
        sessionId: 'sess-1',
        text: 'I want to withdraw money',
      });
      expect(result.reply).toBe('Please take a withdrawal slip.');
      expect(result.transcript).toBeNull();
    });

    it('sends the bearer token', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { reply: 'ok' }));
      vi.stubGlobal('fetch', fetchMock);

      await client.sendMessage({ ...BASE_REQUEST, input: { type: 'text', text: 'hello' } });

      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer a-token');
    });
  });

  describe('a spoken turn', () => {
    it('uploads the recording as multipart to the voice endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(200, {
          reply: 'Please take a withdrawal slip.',
          transcript: 'I want to withdraw money',
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const audio = new Blob([new Uint8Array(128)], { type: 'audio/webm' });

      const result = await client.sendMessage({
        ...BASE_REQUEST,
        input: { type: 'voice', audio, mimeType: 'audio/webm' },
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/assistant\/voice$/);
      expect(init.body).toBeInstanceOf(FormData);

      const form = init.body as FormData;
      expect(form.get('sessionId')).toBe('sess-1');
      expect(form.get('audio')).toBeInstanceOf(Blob);

      // The transcript is what the customer will see as their own
      // message, so it has to survive the round trip.
      expect(result.transcript).toBe('I want to withdraw money');
      expect(result.reply).toBe('Please take a withdrawal slip.');
    });

    it('lets FormData set its own Content-Type', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { reply: 'ok' }));
      vi.stubGlobal('fetch', fetchMock);

      await client.sendMessage({
        ...BASE_REQUEST,
        input: { type: 'voice', audio: new Blob(['x'], { type: 'audio/mp4' }), mimeType: 'audio/mp4' },
      });

      // Setting it by hand would strip the multipart boundary and the
      // upload would arrive unparseable.
      expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
    });

    it('names the upload with an extension the decoder understands', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { reply: 'ok' }));
      vi.stubGlobal('fetch', fetchMock);

      await client.sendMessage({
        ...BASE_REQUEST,
        input: { type: 'voice', audio: new Blob(['x'], { type: 'audio/mp4' }), mimeType: 'audio/mp4' },
      });

      const form = fetchMock.mock.calls[0][1].body as FormData;
      const file = form.get('audio') as File;

      // Safari records MP4; a .webm name would send Whisper looking for
      // the wrong container.
      expect(file.name).toBe('utterance.m4a');
    });
  });

  describe('the reply', () => {
    it('normalises workflow progress', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse(200, {
            reply: 'Fill in your account number.',
            workflow: { name: 'withdraw money', state: 'active', step: 2, totalSteps: 5 },
          }),
        ),
      );

      const result = await client.sendMessage({
        ...BASE_REQUEST,
        input: { type: 'text', text: 'I have the slip' },
      });

      expect(result.workflow).toEqual({
        name: 'withdraw money',
        state: 'active',
        step: 2,
        totalSteps: 5,
      });
    });

    it('treats an unrecognised workflow state as no workflow', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse(200, {
            reply: 'ok',
            workflow: { name: null, state: 'something-new', step: null, totalSteps: null },
          }),
        ),
      );

      const result = await client.sendMessage({
        ...BASE_REQUEST,
        input: { type: 'text', text: 'hello' },
      });

      // A future engine state must not become an invalid value the UI
      // then tries to render.
      expect(result.workflow?.state).toBe('none');
    });
  });

  describe('speaking a reply', () => {
    it('fetches audio from the speak endpoint', async () => {
      // Bytes, not a Blob: jsdom's Blob has no stream(), which Node's
      // Response needs when handed one.
      const audio = new Uint8Array(512);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(audio, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await client.speak({ sessionId: 'sess-1', text: 'Please take a slip.' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/assistant\/speak$/);
      expect(JSON.parse(init.body)).toEqual({ sessionId: 'sess-1', text: 'Please take a slip.' });
      // Not toBeInstanceOf(Blob): response.blob() returns Node's Blob while
      // jsdom replaces the global one, so the two never match here. In a
      // browser there is only one.
      expect(Object.prototype.toString.call(result)).toBe('[object Blob]');
      expect(result.size).toBe(512);
      expect(result.type).toBe('audio/mpeg');
    });

    it('never sends a language of its own', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await client.speak({ sessionId: 'sess-1', text: 'hello' });

      // The visit decides the voice; a client that could name it could
      // have a Kannada customer answered in English.
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('language');
    });

    it('surfaces a speech failure as an ApiError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse(502, {
            statusCode: 502,
            message: 'The spoken reply is unavailable right now.',
          }),
        ),
      );

      await expect(client.speak({ sessionId: 'sess-1', text: 'hello' })).rejects.toMatchObject({
        status: 502,
        message: /unavailable/i,
      });
    });
  });

  describe('failures', () => {
    it('surfaces the API message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse(504, {
            statusCode: 504,
            message: 'The assistant took too long to answer. Please try again.',
          }),
        ),
      );

      await expect(
        client.sendMessage({ ...BASE_REQUEST, input: { type: 'text', text: 'hello' } }),
      ).rejects.toMatchObject({ status: 504, message: /took too long/i });
    });

    it('reports an unreachable server rather than crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const failure = await client
        .sendMessage({ ...BASE_REQUEST, input: { type: 'text', text: 'hello' } })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).isNetworkError).toBe(true);
    });

    it('gives a spoken turn longer than the default before giving up', async () => {
      vi.useFakeTimers();

      let abortedAt: number | null = null;
      const start = Date.now();

      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                abortedAt = Date.now() - start;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        ),
      );

      const pending = client
        .sendMessage({ ...BASE_REQUEST, input: { type: 'text', text: 'hello' } })
        .catch((error: unknown) => error);

      // Well past the client's ordinary 15s budget.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(abortedAt).toBeNull();

      await vi.advanceTimersByTimeAsync(31_000);
      const failure = await pending;

      expect(abortedAt).not.toBeNull();
      expect(failure).toBeInstanceOf(ApiError);
      vi.useRealTimers();
    });
  });
});

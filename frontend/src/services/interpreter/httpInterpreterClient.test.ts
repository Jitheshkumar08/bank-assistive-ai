import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpInterpreterClient } from './httpInterpreterClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const client = new HttpInterpreterClient();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpInterpreterClient', () => {
  it('uploads a recording as multipart, with the speaker’s language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { text: 'hello', language: 'ta' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.transcribe({
      sessionId: 'sess-1',
      language: 'ta',
      audio: new Blob(['x'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
    });

    const [url, init] = fetchMock.mock.calls[0];
    const form = init.body as FormData;
    expect(url).toMatch(/\/assistant\/interpreter\/transcribe$/);
    expect(form.get('sessionId')).toBe('sess-1');
    expect(form.get('language')).toBe('ta');
    expect((form.get('audio') as File).name).toBe('utterance.m4a');
    // FormData sets its own boundary.
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(result).toEqual({ text: 'hello', language: 'ta' });
  });

  it('posts a translation request to the interpreter, never to the assistant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { translation: 'ನಮಸ್ಕಾರ' }));
    vi.stubGlobal('fetch', fetchMock);

    await client.translate({
      sessionId: 'sess-1',
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'kn',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/assistant\/interpreter\/translate$/);
    expect(url).not.toMatch(/\/assistant\/(message|voice)$/);
    expect(JSON.parse(init.body)).toEqual({
      sessionId: 'sess-1',
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'kn',
    });
  });

  it('asks for speech in the listener’s language', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const audio = await client.speak({ sessionId: 'sess-1', text: 'Sign here', language: 'en' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/assistant\/interpreter\/speak$/);
    expect(JSON.parse(init.body)).toEqual({ sessionId: 'sess-1', text: 'Sign here', language: 'en' });
    // fetch's Blob comes from Node's realm, not jsdom's: compare contents.
    expect(audio.size).toBe(2);
  });

  it('surfaces a refusal as the server’s message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, { statusCode: 400, message: 'The interpreter does not support French.' }),
      ),
    );

    await expect(
      client.translate({ sessionId: 's', text: 'hi', sourceLanguage: 'en', targetLanguage: 'fr' }),
    ).rejects.toMatchObject({ status: 400, message: 'The interpreter does not support French.' });
  });
});

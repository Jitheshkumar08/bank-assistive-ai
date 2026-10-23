import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpAssistantClient } from './httpAssistantClient';
import { setTokenReader, setUnauthorizedHandler } from '@/api/client';
import { ApiError } from '@/types/api';

/**
 * HttpAssistantClient.getSnapshot against a stubbed fetch, shaped like the
 * NestJS route GET /api/assistant/sessions/:sessionId/snapshot. Not a call
 * to the real server.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ACTIVE = {
  known: true,
  ended: false,
  workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
};

describe('HttpAssistantClient.getSnapshot', () => {
  const client = new HttpAssistantClient();

  beforeEach(() => {
    setTokenReader(() => 'a-token');
    setUnauthorizedHandler(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('GETs the visit’s snapshot with the customer’s token and no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, ACTIVE));
    vi.stubGlobal('fetch', fetchMock);

    await client.getSnapshot('sess-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/assistant\/sessions\/sess-1\/snapshot$/);
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer a-token');
    expect(init.body).toBeUndefined();
  });

  it('returns a known snapshot unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, ACTIVE)));

    await expect(client.getSnapshot('sess-1')).resolves.toEqual(ACTIVE);
  });

  it('maps an unrecognised workflow state to none, as replies do', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, { ...ACTIVE, workflow: { ...ACTIVE.workflow, state: 'mystery' } }),
      ),
    );

    const snapshot = await client.getSnapshot('sess-1');

    expect(snapshot.workflow?.state).toBe('none');
  });

  it('keeps an unknown visit unknown, whatever else the body says', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { known: false, ended: false, workflow: ACTIVE.workflow })),
    );

    await expect(client.getSnapshot('sess-1')).resolves.toEqual({
      known: false,
      ended: false,
      workflow: null,
    });
  });

  it('refuses a body without an explicit known flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { workflow: null })));

    await expect(client.getSnapshot('sess-1')).rejects.toMatchObject({ status: 502 });
  });

  it('surfaces a 409 (turn still running) as an ApiError with the server’s message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          statusCode: 409,
          message: 'The assistant is still working on the last request.',
          error: 'Conflict',
        }),
      ),
    );

    const failure = client.getSnapshot('sess-1');

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      message: 'The assistant is still working on the last request.',
    });
  });

  it('honours a caller’s cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      ),
    );
    const controller = new AbortController();

    const pending = client.getSnapshot('sess-1', controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ApiError);
  });
});

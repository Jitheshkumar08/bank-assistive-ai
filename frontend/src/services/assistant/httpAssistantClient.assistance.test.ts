import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpAssistantClient } from './httpAssistantClient';
import { setTokenReader, setUnauthorizedHandler } from '@/api/client';
import { ApiError } from '@/types/api';

/**
 * HttpAssistantClient.requestAssistance against a stubbed fetch, shaped like
 * the NestJS route POST /api/assistant/sessions/:sessionId/assistance. Not a
 * call to the real server.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OFFER = {
  offered: true,
  reason: 'offered',
  field: 'amount',
  promptId: 'amount.1',
  text: 'Would you like me to explain how to enter the amount? Just say help.',
};

describe('HttpAssistantClient.requestAssistance', () => {
  const client = new HttpAssistantClient();

  beforeEach(() => {
    setTokenReader(() => 'a-token');
    setUnauthorizedHandler(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('POSTs only the last offer id, with the customer’s token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, OFFER));
    vi.stubGlobal('fetch', fetchMock);

    await client.requestAssistance('sess-1', 'amount.2');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/assistant\/sessions\/sess-1\/assistance$/);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer a-token');
    expect(JSON.parse(init.body)).toEqual({ avoid: 'amount.2' });
  });

  it('sends an empty body when there is nothing to avoid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, OFFER));
    vi.stubGlobal('fetch', fetchMock);

    await client.requestAssistance('sess-1', null);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
  });

  it('returns an offer unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, OFFER)));

    await expect(client.requestAssistance('sess-1', null)).resolves.toEqual(OFFER);
  });

  it('never reports an offer with nothing to say', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ...OFFER, text: ' ' })));

    const result = await client.requestAssistance('sess-1', null);

    expect(result.offered).toBe(false);
    expect(result.text).toBeNull();
  });

  it('drops any text that came with "no offer"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, { offered: false, reason: 'paused', field: null, promptId: null, text: 'x' }),
      ),
    );

    await expect(client.requestAssistance('sess-1', null)).resolves.toEqual({
      offered: false,
      reason: 'paused',
      field: null,
      promptId: null,
      text: null,
    });
  });

  it('refuses a body without an offered flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { reason: 'offered' })));

    await expect(client.requestAssistance('sess-1', null)).rejects.toBeInstanceOf(ApiError);
  });

  it('passes a busy assistant (409) on as an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, { message: 'still working', statusCode: 409 })),
    );

    await expect(client.requestAssistance('sess-1', null)).rejects.toMatchObject({ status: 409 });
  });
});

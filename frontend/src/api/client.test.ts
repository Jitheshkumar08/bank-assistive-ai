import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setTokenReader, setUnauthorizedHandler } from './client';
import { ApiError } from '@/types/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    setTokenReader(() => null);
    setUnauthorizedHandler(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));

    await expect(api.get('/thing')).resolves.toEqual({ ok: true });
  });

  it('attaches the bearer token when one is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    setTokenReader(() => 'a-token');

    await api.get('/thing');

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer a-token');
  });

  it('sends no Authorization header when signed out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/thing');

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces the first message when the API returns a validation array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          statusCode: 400,
          message: ['branchCode is required.', 'branchCode must be a string'],
          error: 'Bad Request',
        }),
      ),
    );

    // Users read one clear sentence; the rest stay on `details`.
    await expect(api.post('/thing')).rejects.toMatchObject({
      status: 400,
      message: 'branchCode is required.',
      details: ['branchCode is required.', 'branchCode must be a string'],
    });
  });

  it('signs the user out when the API rejects the token', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { statusCode: 401, message: 'nope' })),
    );

    await expect(api.get('/thing')).rejects.toBeInstanceOf(ApiError);
    // One rejected call must clear the session everywhere, not just fail
    // the request that noticed.
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable server as a network error, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    try {
      await api.get('/thing');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).isNetworkError).toBe(true);
      expect((error as ApiError).message).toMatch(/connection/i);
    }
  });

  it('does not choke on a success response with an empty body', async () => {
    // This is exactly what GET /sessions/active returns when there is
    // no active visit: 200 with zero bytes.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    await expect(api.get('/sessions/active')).resolves.toBeNull();
  });

  it('treats 204 as no content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api.get('/thing')).resolves.toBeUndefined();
  });

  it('still fails cleanly when an error response is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })),
    );

    await expect(api.get('/thing')).rejects.toMatchObject({ status: 502 });
  });
});

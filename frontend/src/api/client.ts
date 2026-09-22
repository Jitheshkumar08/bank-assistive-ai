import { ApiError, type ApiErrorBody } from '@/types/api';

function getBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;

  if (typeof window !== 'undefined' && window.location) {
    const { hostname, protocol } = window.location;

    // When accessed from another device on the local network (e.g. mobile phone),
    // point to the host machine's IP instead of the phone's localhost.
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      if (envUrl) {
        return envUrl.replace(/localhost|127\.0\.0\.1/, hostname);
      }
      return `${protocol}//${hostname}:3000/api`;
    }
  }

  return envUrl ?? 'http://localhost:3000/api';
}

const BASE_URL = getBaseUrl();

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Reads the bearer token for outgoing requests.
 *
 * Installed by the auth layer rather than imported from it, so this
 * module stays free of application state and can be tested on its own.
 */
type TokenReader = () => string | null;

let readToken: TokenReader = () => null;

export function setTokenReader(reader: TokenReader): void {
  readToken = reader;
}

/** Called when the API rejects our token, so the app can sign the user out. */
type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler = () => {};

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Overrides the default budget for this one call.
   *
   * Ordinary reads answer in milliseconds; a spoken turn has to wait for
   * speech recognition and a language model. Rather than raising the
   * limit for everything, the assistant asks for the time it needs.
   */
  timeoutMs?: number;
}

function toMessage(body: ApiErrorBody | null, status: number): string {
  if (!body) {
    return status === 0
      ? 'Cannot reach the server. Check your connection and try again.'
      : 'Something went wrong. Please try again.';
  }

  // Validation failures arrive as an array; the first is the most useful
  // thing to put in front of someone.
  return Array.isArray(body.message) ? body.message[0] : body.message;
}

function toDetails(body: ApiErrorBody | null): string[] {
  if (!body) return [];
  return Array.isArray(body.message) ? body.message : [body.message];
}

/**
 * The single path every API call takes.
 *
 * Attaches auth, enforces a timeout, and turns every failure mode --
 * HTTP error, network drop, timeout -- into one ApiError.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller's own cancellation alongside our timeout.
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const headers: Record<string, string> = { Accept: 'application/json' };
  // FormData sets its own Content-Type, including the multipart
  // boundary. Setting it here would corrupt the upload.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';

  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);

    const aborted = error instanceof DOMException && error.name === 'AbortError';

    throw new ApiError(
      aborted
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the server. Check your connection and try again.',
      0,
    );
  }

  clearTimeout(timeout);

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;

    // A rejected token must sign the user out everywhere, not just fail
    // the one call that noticed.
    if (response.status === 401) {
      onUnauthorized();
    }

    throw new ApiError(toMessage(errorBody, response.status), response.status, toDetails(errorBody));
  }

  return payload as T;
}

/**
 * Posts JSON and reads a binary response.
 *
 * Shares the token, timeout and error conventions of request(); only the
 * response handling differs.
 */
export async function requestBlob(
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);

    const aborted = error instanceof DOMException && error.name === 'AbortError';

    throw new ApiError(
      aborted
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the server. Check your connection and try again.',
      0,
    );
  }

  clearTimeout(timeout);

  if (!response.ok) {
    if (response.status === 401) onUnauthorized();

    let errorBody: ApiErrorBody | null = null;

    try {
      errorBody = (await response.json()) as ApiErrorBody;
    } catch {
      errorBody = null;
    }

    throw new ApiError(toMessage(errorBody, response.status), response.status, toDetails(errorBody));
  }

  return response.blob();
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'POST', body, signal }),
  /** Partial updates: send what changed, leave the rest untouched. */
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'PATCH', body, signal }),
  delete: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: 'DELETE', signal }),
  /** For calls that legitimately take longer than an ordinary request. */
  postSlow: <T>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal) =>
    request<T>(path, { method: 'POST', body, signal, timeoutMs }),
  /**
   * For responses that are binary rather than JSON.
   *
   * Audio must not go through the JSON path, which would destroy it.
   * Errors still arrive as JSON and are normalised the same way.
   */
  postForBlob: (path: string, body: unknown, timeoutMs: number, signal?: AbortSignal) =>
    requestBlob(path, body, timeoutMs, signal),
};

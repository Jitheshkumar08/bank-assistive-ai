import { config } from '../config'
import { notConnected, ServiceError, type FieldErrors, type ServiceErrorCode } from './errors'

const statusCodes: Record<number, ServiceErrorCode> = { 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'FILE_TOO_LARGE', 429: 'RATE_LIMITED' }
// Codes the backend sends (backend/src/common/api-error.ts) that the UI reacts to; anything else falls back by status.
const knownCodes = new Set<string>([
  'UNAUTHENTICATED', 'NOT_FOUND', 'NOT_VERIFIED', 'REFERENCE_MISMATCH', 'NO_ADMISSION_RECORD', 'AMBIGUOUS_ADMISSION_RECORD', 'INVALID_QR', 'VALIDATION_FAILED', 'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED', 'ACCOUNT_DISABLED', 'INVALID_OR_EXPIRED_TOKEN', 'EMAIL_PROVIDER_NOT_CONFIGURED', 'EMAIL_DELIVERY_FAILED', 'RATE_LIMITED',
  'FORBIDDEN', 'CONFLICT', 'INVALID_FILE', 'FILE_TOO_LARGE', 'IMPORT_ALREADY_PROCESSED', 'IMPORT_PREVIEW_EXPIRED', 'IMPORT_STALE',
  'ASSISTANT_UNAVAILABLE', 'VOICE_NOT_UNDERSTOOD',
])

type Listener = () => void
const unauthenticatedListeners = new Set<Listener>()

/** Called whenever the backend answers UNAUTHENTICATED (expired or revoked session). Returns an unsubscribe function. */
export function onUnauthenticated(listener: Listener) {
  unauthenticatedListeners.add(listener)
  return () => { unauthenticatedListeners.delete(listener) }
}

function parseDetails(value: unknown): FieldErrors | undefined {
  if (!Array.isArray(value)) return undefined
  const details = value.filter((item): item is { field: string; messages: string[] } =>
    Boolean(item) && typeof item.field === 'string' && Array.isArray(item.messages) && item.messages.every((message: unknown) => typeof message === 'string'))
  return details.length ? details : undefined
}

/**
 * JSON request to the CampusGuide backend. Sends the HttpOnly session cookie; never adds tokens or identity itself.
 * Server messages are shown only for 4xx responses (and the honest 503 "email not configured" family); other 5xx
 * details are replaced with a generic message.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}, what = 'This service'): Promise<T> {
  const response = await send(path, init, what, 'application/json')
  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw toServiceError(response, data)
  return data as T
}

/** Fetches a binary file from the API with the session cookie (e.g. a QR image to preview). */
export async function apiBlob(path: string, what = 'This download', init: RequestInit = {}): Promise<{ blob: Blob; fileName: string | null }> {
  const response = await send(path, init, what, '*/*')
  if (!response.ok) throw toServiceError(response, await response.json().catch(() => null))
  const blob = await response.blob()
  return { blob, fileName: /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? null }
}

/** Downloads a file from the API (e.g. a CSV report) with the session cookie and hands it to the browser. */
export async function apiDownload(path: string, fallbackName: string, what = 'This download') {
  const { blob, fileName } = await apiBlob(path, what)
  const name = fileName ?? fallbackName
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

async function send(path: string, init: RequestInit, what: string, accept: string) {
  if (!config.apiBaseUrl) throw notConnected(what)
  const headers = new Headers(init.headers)
  headers.set('Accept', accept)
  // FormData sets its own multipart boundary; everything else is JSON.
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  try {
    return await fetch(`${config.apiBaseUrl}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new ServiceError('NETWORK', 'Could not reach CampusGuide. Check your connection and try again.')
  }
}

function toServiceError(response: Response, data: unknown) {
  const body = (data && typeof data === 'object' ? data : {}) as { code?: unknown; message?: unknown; details?: unknown }
  const code = typeof body.code === 'string' && knownCodes.has(body.code) ? body.code as ServiceErrorCode : statusCodes[response.status] ?? 'UNKNOWN'
  const showServerMessage = response.status < 500 || code === 'EMAIL_PROVIDER_NOT_CONFIGURED' || code === 'EMAIL_DELIVERY_FAILED' || code === 'ASSISTANT_UNAVAILABLE'
  const message = showServerMessage && typeof body.message === 'string' ? body.message : 'CampusGuide couldn’t complete the request. Please try again later.'
  if (code === 'UNAUTHENTICATED') unauthenticatedListeners.forEach((listener) => listener())
  return new ServiceError(code, message, parseDetails(body.details))
}

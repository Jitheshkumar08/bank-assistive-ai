import { config } from '../../config'
import { notConnected, ServiceError } from '../errors'
import { apiBlob, apiRequest } from '../http'

/** Student Portal languages sent with each question (en / kn / hi). 'tcy' (Tulu) is paused but kept for later. */
export type GuidanceLanguage = 'en' | 'kn' | 'hi' | 'tcy'

export type ChatTurn = { role: 'user' | 'assistant'; text: string }

export type AssistantRequest = {
  message: string
  /** Kept for compatibility; the backend ignores it (the conversation is held server-side). */
  history: ChatTurn[]
  /** Validated college context from the QR scan, or null before scanning. */
  collegeId: string | null
  /** QR placement (location) from the same scan, if any. Context only — never identity. */
  area?: string | null
  language: GuidanceLanguage
  /** How the question was entered; 'voice' is reserved for future speech-to-text. */
  inputMode: 'text' | 'voice'
}

/**
 * The signed-in student's own admission information, exactly as the backend derived it from the official record for
 * the session's account (Phase 6). Never built or edited in the browser. `null` = not available (never guessed).
 */
export type AssistantStudentContext = {
  verified: boolean
  admissionYear: number | null
  rank: number | null
  category: string | null
  allocatedBranch: string | null
  assignedBatch: string | null
  assignedHall: string | null
  admissionStatus: string | null
  nextStep: string | null
}

export type AssistantReply = {
  text: string
  intent?: string | null
  steps?: string[] | null
  outcome?: string | null
  studentContext?: AssistantStudentContext | null
}

export interface AssistantService {
  send(request: AssistantRequest): Promise<AssistantReply>
  /** Reads an assistant reply aloud (audio from the backend). Optional: absent = spoken answers unavailable. */
  speak?(text: string): Promise<Blob>
}

/** A reply slower than this is reported as a timeout instead of leaving the chat waiting. */
export const ASSISTANT_TIMEOUT_MS = 45_000

export const backendPendingAssistantService: AssistantService = {
  async send() { throw notConnected('The CampusGuide assistant') },
}

const textOrNull = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const intOrNull = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)

/** Accepts only a well-formed, verified context; anything else is dropped so nothing unexpected is rendered. */
export function parseStudentContext(value: unknown): AssistantStudentContext | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.verified !== true) return null
  return {
    verified: true,
    admissionYear: intOrNull(raw.admissionYear),
    rank: intOrNull(raw.rank),
    category: textOrNull(raw.category),
    allocatedBranch: textOrNull(raw.allocatedBranch),
    assignedBatch: textOrNull(raw.assignedBatch),
    assignedHall: textOrNull(raw.assignedHall),
    admissionStatus: textOrNull(raw.admissionStatus),
    nextStep: textOrNull(raw.nextStep),
  }
}

const timedOut = () => new ServiceError('NETWORK', 'The assistant is taking too long to answer. Please try again.')

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS)
  try {
    return await run(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw timedOut()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const httpAssistantService: AssistantService = {
  async send(request) {
    const body = await withTimeout((signal) => apiRequest<{ text?: unknown; intent?: unknown; steps?: unknown; outcome?: unknown; studentContext?: unknown }>(
      '/assistant/messages', { method: 'POST', body: JSON.stringify(request), signal }, 'The CampusGuide assistant'))
    if (typeof body.text !== 'string' || !body.text.trim()) throw new ServiceError('INVALID_RESPONSE', 'The assistant returned an empty answer. Please try again.')
    return {
      text: body.text,
      intent: typeof body.intent === 'string' ? body.intent : null,
      steps: Array.isArray(body.steps) ? body.steps.filter((step): step is string => typeof step === 'string') : null,
      outcome: typeof body.outcome === 'string' ? body.outcome : null,
      studentContext: parseStudentContext(body.studentContext),
    }
  },
  async speak(text) {
    const { blob } = await withTimeout((signal) => apiBlob('/assistant/speech', 'The spoken answer', { method: 'POST', body: JSON.stringify({ text }), signal }))
    if (!blob.type.startsWith('audio/') || blob.size === 0) throw new ServiceError('INVALID_RESPONSE', 'The spoken answer could not be played.')
    return blob
  },
}

export const assistantService: AssistantService = config.apiBaseUrl ? httpAssistantService : backendPendingAssistantService

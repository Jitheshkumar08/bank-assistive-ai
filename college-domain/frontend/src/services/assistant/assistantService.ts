import { config } from '../../config'
import { notConnected, ServiceError } from '../errors'
import { apiBlob, apiRequest } from '../http'

/** Student Portal languages sent with each question (en / kn / hi). 'tcy' (Tulu) is paused but kept for later. */
export type GuidanceLanguage = 'en' | 'kn' | 'hi' | 'tcy'

/**
 * One question to the assistant. There is deliberately NO conversation history: the language engine keeps the
 * conversation server-side, the backend ignored any history it was sent, and sending the whole chat every time made
 * long conversations fail (the backend accepts at most 100 entries in a 100 kB body).
 */
export type AssistantRequest = {
  message: string
  /** Validated college context from the QR scan, or null before scanning. */
  collegeId: string | null
  /** QR placement (location) from the same scan, if any. Context only — never identity. */
  area?: string | null
  language: GuidanceLanguage
  /** How the question was entered. Spoken questions use AssistantService.sendVoice instead. */
  inputMode: 'text' | 'voice'
}

/**
 * One spoken question (Phase 7): the recording plus the same context a typed question carries. The language engine
 * transcribes it and answers it exactly like a typed question; the recording is not kept anywhere.
 */
export type AssistantVoiceRequest = {
  audio: Blob
  collegeId: string | null
  area?: string | null
  language: GuidanceLanguage
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
  /** Spoken questions only: what the assistant heard, shown as the student's own message. */
  transcript?: string | null
}

export interface AssistantService {
  send(request: AssistantRequest): Promise<AssistantReply>
  /** Asks a spoken question. Optional: absent = voice input unavailable. */
  sendVoice?(request: AssistantVoiceRequest): Promise<AssistantReply>
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

type ReplyBody = { text?: unknown; intent?: unknown; steps?: unknown; outcome?: unknown; studentContext?: unknown; transcript?: unknown }

/** The backend's reply, checked field by field; anything malformed is dropped rather than rendered. */
function parseReply(body: ReplyBody): AssistantReply {
  if (typeof body.text !== 'string' || !body.text.trim()) throw new ServiceError('INVALID_RESPONSE', 'The assistant returned an empty answer. Please try again.')
  const transcript = textOrNull(body.transcript)
  return {
    text: body.text,
    intent: typeof body.intent === 'string' ? body.intent : null,
    steps: Array.isArray(body.steps) ? body.steps.filter((step): step is string => typeof step === 'string') : null,
    outcome: typeof body.outcome === 'string' ? body.outcome : null,
    studentContext: parseStudentContext(body.studentContext),
    // Spoken questions only; a typed reply keeps exactly its earlier shape.
    ...(transcript ? { transcript } : {}),
  }
}

/** File name sent with a recording; the backend ignores it and uses the type. */
const recordingName = (type: string) => (type.includes('ogg') ? 'question.ogg' : type.includes('mp4') ? 'question.m4a' : 'question.webm')

export const httpAssistantService: AssistantService = {
  async send(request) {
    // Only these fields are sent, even if a caller passes more (e.g. an old `history` array).
    const { message, collegeId, area, language, inputMode } = request
    const payload = JSON.stringify({ message, collegeId, area, language, inputMode })
    return parseReply(await withTimeout((signal) => apiRequest<ReplyBody>(
      '/assistant/messages', { method: 'POST', body: payload, signal }, 'The CampusGuide assistant')))
  },
  async sendVoice({ audio, collegeId, area, language }) {
    // Only the recording, the language and the scanned QR context; identity comes from the session cookie.
    const form = new FormData()
    form.set('language', language)
    if (collegeId) form.set('collegeId', collegeId)
    if (area) form.set('area', area)
    form.set('audio', audio, recordingName(audio.type))
    return parseReply(await withTimeout((signal) => apiRequest<ReplyBody>(
      '/assistant/voice-messages', { method: 'POST', body: form, signal }, 'The CampusGuide assistant')))
  },
  async speak(text) {
    const { blob } = await withTimeout((signal) => apiBlob('/assistant/speech', 'The spoken answer', { method: 'POST', body: JSON.stringify({ text }), signal }))
    if (!blob.type.startsWith('audio/') || blob.size === 0) throw new ServiceError('INVALID_RESPONSE', 'The spoken answer could not be played.')
    return blob
  },
}

export const assistantService: AssistantService = config.apiBaseUrl ? httpAssistantService : backendPendingAssistantService

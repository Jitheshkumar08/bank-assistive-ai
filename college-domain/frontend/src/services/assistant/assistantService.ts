import { config } from '../../config'
import { notConnected, ServiceError } from '../errors'
import { apiRequest } from '../http'

/** Student Portal languages sent with each question (en / kn / hi). 'tcy' (Tulu) is paused but kept for later. */
export type GuidanceLanguage = 'en' | 'kn' | 'hi' | 'tcy'

export type ChatTurn = { role: 'user' | 'assistant'; text: string }

export type AssistantRequest = {
  message: string
  history: ChatTurn[]
  /** Validated college context from the QR scan, or null before scanning. */
  collegeId: string | null
  language: GuidanceLanguage
  /** How the question was entered; 'voice' is reserved for future speech-to-text. */
  inputMode: 'text' | 'voice'
}

/** Room for future intent detection and step-by-step workflows without changing the chat UI contract. */
export type AssistantReply = {
  text: string
  intent?: string | null
  steps?: string[] | null
}

export interface AssistantService {
  send(request: AssistantRequest): Promise<AssistantReply>
}

export const backendPendingAssistantService: AssistantService = {
  async send() { throw notConnected('The CampusGuide assistant') },
}

export const httpAssistantService: AssistantService = {
  async send(request) {
    const body = await apiRequest<{ text?: unknown; intent?: unknown; steps?: unknown }>('/assistant/messages', { method: 'POST', body: JSON.stringify(request) }, 'The CampusGuide assistant')
    if (typeof body.text !== 'string' || !body.text.trim()) throw new ServiceError('INVALID_RESPONSE', 'The assistant returned an empty answer. Please try again.')
    return {
      text: body.text,
      intent: typeof body.intent === 'string' ? body.intent : null,
      steps: Array.isArray(body.steps) ? body.steps.filter((step): step is string => typeof step === 'string') : null,
    }
  },
}

export const assistantService: AssistantService = config.apiBaseUrl ? httpAssistantService : backendPendingAssistantService

import { z } from 'zod'
import type { AdmissionDetailsDto } from '../admission/admission.dto.js'

/**
 * Phase 6 — the typed contracts around the CampusGuide assistant.
 *
 *   browser ──AssistantMessageDto──▶ College backend ──EngineTurnRequest──▶ language engine
 *   browser ◀──AssistantReply──────  College backend ◀──EngineTurnResponse── language engine
 *
 * The engine receives the student's words, the language and the scanned college context — never identity or admission
 * data. When it needs the signed-in student's admission details it returns an action; the backend performs it (the
 * Result page's own rules) and answers with an outcome CODE only. The details themselves go straight from this backend
 * to the browser as `AssistantStudentContext`.
 */

/** Languages the Student Portal sends (en / kn / hi; 'tcy' is answered in English by the engine). */
export const ASSISTANT_LANGUAGES = ['en', 'kn', 'hi', 'tcy'] as const
export type AssistantLanguage = (typeof ASSISTANT_LANGUAGES)[number]

/** The only backend action the College engine defines (admission_status.json), and the workflow it belongs to. */
export const ADMISSION_STATUS_ACTION = 'admission_status'
export const ADMISSION_STATUS_WORKFLOW = 'admission status'

// ───────────────────────────── Engine wire format (validated on every response) ─────────────────────────────

const identifier = /^[A-Za-z0-9_-]{8,64}$/

export const engineActionSchema = z.object({
  id: z.string().regex(identifier),
  type: z.string().regex(/^[a-z][a-z_]{1,39}$/),
  workflow: z.string().min(1).max(80),
})

/**
 * What the engine answers for a College turn or workflow result. `domain` must be exactly "college": a reply from any
 * other domain's runtime is a contract violation and is never shown (no Banking fallback).
 */
export const engineTurnResponseSchema = z.object({
  reply: z.string().min(1).max(8000),
  domain: z.literal('college'),
  intent: z.string().max(80).nullable().optional(),
  outcome: z.string().max(80).nullable().optional(),
  steps: z.array(z.string().max(2000)).max(50).nullable().optional(),
  action: engineActionSchema.nullable().optional(),
  ended: z.boolean().optional(),
  /** Spoken turns only: what the engine heard, in the student's own words. */
  transcript: z.string().max(4000).nullable().optional(),
})
export type EngineTurnResponse = z.infer<typeof engineTurnResponseSchema>
export type EngineAction = z.infer<typeof engineActionSchema>

/** A refusal body from the engine: a stable code only is read (the detail text is never logged or forwarded). */
export const engineErrorSchema = z.object({ error: z.string().regex(/^[a-z_]{1,40}$/).optional() })

export type EngineTurnRequest = {
  sessionId: string
  language: AssistantLanguage
  text: string
  institutionId: string
  area: string | null
}

/**
 * A spoken question (Phase 7): the recording replaces the text; everything else is the same as EngineTurnRequest. The
 * engine transcribes it with its shared speech recogniser and runs exactly the same turn a typed question takes.
 */
export type EngineAudioTurnRequest = Omit<EngineTurnRequest, 'text'> & {
  audio: Buffer
  /** A normalised audio MIME type from the allow-list (never the browser's file name). */
  mimeType: string
}

export type EngineWorkflowResult = { actionId: string; actionType: string; outcome: string }

// ───────────────────────────── Student context (backend → browser only) ─────────────────────────────

/**
 * The signed-in student's admission information for the assistant, derived ONLY from the server-side session and the
 * official AdmissionRecord found for it (AdmissionService.getDetails). Never sent to the language engine.
 *
 * Fields with no trusted source in the CampusGuide data model are typed `null` and always null — never guessed:
 *  - category: reservation category is not imported (README: a plain "Category" column is deliberately ignored), and
 *    the fee category is not exposed to students;
 *  - assignedBatch, assignedHall, nextStep: not part of the data model yet.
 */
export type AssistantStudentContext = {
  /** True: the record was matched to the signed-in account by its verified email (the Result page's rule). */
  verified: true
  admissionYear: number | null
  rank: number | null
  category: null
  allocatedBranch: string | null
  assignedBatch: null
  assignedHall: null
  admissionStatus: string | null
  nextStep: null
}

/** Only these fields leave the backend; the name and fee in AdmissionDetailsDto are not part of the assistant contract. */
export function toStudentContext(details: AdmissionDetailsDto): AssistantStudentContext {
  return {
    verified: true,
    admissionYear: details.admissionYear ?? null,
    rank: details.nucatRank ?? null,
    category: null,
    allocatedBranch: details.allocatedBranch ?? null,
    assignedBatch: null,
    assignedHall: null,
    admissionStatus: details.admissionStatus ?? null,
    nextStep: null,
  }
}

/** The assistant's answer to the browser. */
export type AssistantReply = {
  text: string
  language: AssistantLanguage
  intent: string | null
  outcome: string | null
  steps: string[] | null
  /** Present only after an admission-status lookup that found the student's own record. */
  studentContext: AssistantStudentContext | null
  /** Spoken questions only: what the engine heard, shown back as the student's own message. */
  transcript?: string
}

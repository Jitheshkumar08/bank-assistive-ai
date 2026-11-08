import { Injectable } from '@nestjs/common'
import type { AdmissionDetailsDto } from '../admission/admission.dto.js'
import { AdmissionService } from '../admission/admission.service.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ApiError } from '../common/api-error.js'

/**
 * Outcome codes of the shared language engine's admission-status workflow
 * (language_engine/app/domains/college/workflows/admission_status.json). The engine accepts back exactly one of these
 * and nothing else: it never sees the student's record.
 */
export const ADMISSION_STATUS_OUTCOMES = [
  'details_available', 'not_signed_in', 'not_a_student', 'no_record', 'ambiguous_record', 'context_invalid', 'unavailable',
] as const
export type AdmissionStatusOutcome = (typeof ADMISSION_STATUS_OUTCOMES)[number]

/** `details` stays in this backend (it is shown to the student by the CampusGuide app); only `outcome` goes to the engine. */
export type AdmissionStatusLookup = { outcome: AdmissionStatusOutcome; details?: AdmissionDetailsDto }

const outcomeByCode: Partial<Record<ApiError['code'], AdmissionStatusOutcome>> = {
  NO_ADMISSION_RECORD: 'no_record',
  AMBIGUOUS_ADMISSION_RECORD: 'ambiguous_record',
  INVALID_QR: 'context_invalid',
  NOT_FOUND: 'context_invalid',
  UNAUTHENTICATED: 'not_signed_in',
}

/**
 * The assistant's admission-status action (domain integration, Phase 5). Called by AssistantService (Phase 6,
 * POST /api/assistant/messages) when the engine returns an `admission_status` action.
 *
 * Exactly the student portal's own rules, by calling the same service the Result page uses
 * (AdmissionService.getDetails): identity comes ONLY from the signed-in session, the record is the one whose official
 * email is the account's email, the scanned QR context only selects the college and is re-checked, and a record claimed
 * by another account is never shown. It takes no reference number at all: NUCAT reference verification stays on its own
 * rate-limited endpoint and is never done through the assistant chat.
 */
@Injectable()
export class AssistantAdmissionStatusService {
  constructor(private readonly admission: AdmissionService) {}

  async lookup(account: AuthenticatedAccount | null, collegeId: string, area: string | null): Promise<AdmissionStatusLookup> {
    if (!account) return { outcome: 'not_signed_in' }
    // Staff accounts never see results through the student path (as AdmissionController's @Auth('STUDENT')).
    if (account.role !== 'STUDENT') return { outcome: 'not_a_student' }
    try {
      const { details } = await this.admission.getDetails(account, collegeId, area)
      return { outcome: 'details_available', details }
    } catch (error) {
      const outcome = error instanceof ApiError ? outcomeByCode[error.code] : undefined
      return { outcome: outcome ?? 'unavailable' }
    }
  }
}

/** The only part of a lookup that may be sent to the language engine. */
export const engineWorkflowResult = (actionId: string, lookup: AdmissionStatusLookup) => ({ action_id: actionId, outcome: lookup.outcome })

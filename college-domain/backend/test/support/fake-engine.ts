import type { EngineTurnRequest, EngineTurnResponse, EngineWorkflowResult } from '../../src/assistant/assistant.contract.js'
import { CollegeEngineClient, EngineCallError, type EngineSpeech } from '../../src/assistant/engine/college-engine.client.js'

/**
 * A stand-in for the language engine with the same rules as the real one (Phase 5/6): an admission-status question
 * returns an action carrying no data; a workflow result is accepted once, only for the pending action id and type,
 * and only with a defined outcome. Records every call so tests can assert what crossed the boundary.
 */
export const OUTCOME_REPLIES: Record<string, string> = {
  details_available: 'Your admission details from the official records are shown below.',
  not_signed_in: 'Please sign in to your CampusGuide account to see your admission status.',
  not_a_student: 'Admission status is available only to student accounts.',
  no_record: 'I couldn’t find an admission record for the email address of your account.',
  ambiguous_record: 'More than one admission record matches your account, so I can’t show one.',
  context_invalid: 'Please scan the CampusGuide QR code again to continue.',
  unavailable: 'I can’t check your admission status right now. Please try again later or open the Result page.',
}

export class FakeEngine extends CollegeEngineClient {
  readonly turns: EngineTurnRequest[] = []
  readonly results: { sessionId: string; result: EngineWorkflowResult }[] = []
  readonly spoken: { text: string; language: string }[] = []
  readonly ended: string[] = []
  failEnd = false
  readonly pending = new Map<string, { id: string; type: string }>()
  failTurn: EngineCallError | null = null
  failResult: EngineCallError | null = null
  /** Overrides the next turn's response (e.g. a malformed or unexpected action). */
  nextTurn: EngineTurnResponse | null = null
  private counter = 0

  async turn(request: EngineTurnRequest): Promise<EngineTurnResponse> {
    this.turns.push(request)
    if (this.failTurn) throw this.failTurn
    this.pending.delete(request.sessionId) // a new sentence abandons a pending action
    if (this.nextTurn) { const next = this.nextTurn; this.nextTurn = null; return next }
    if (/status|rank|batch|hall|ಸ್ಥಿತಿ/i.test(request.text)) {
      const action = { id: `action-${++this.counter}-abcdefgh`, type: 'admission_status', workflow: 'admission status' }
      this.pending.set(request.sessionId, action)
      return { reply: 'I’ll check your admission status in CampusGuide.', domain: 'college', intent: 'admission_status', outcome: 'action_required', steps: null, action }
    }
    return { reply: `[${request.language}] I don’t have verified information about that yet.`, domain: 'college', intent: 'admission_documents', outcome: 'no_verified_information', steps: null, action: null }
  }

  async workflowResult(sessionId: string, result: EngineWorkflowResult): Promise<EngineTurnResponse> {
    this.results.push({ sessionId, result })
    if (this.failResult) throw this.failResult
    const pending = this.pending.get(sessionId)
    if (!pending || pending.id !== result.actionId) throw new EngineCallError('refused', 409, 'no_pending_action')
    if (pending.type !== result.actionType) throw new EngineCallError('refused', 409, 'action_mismatch')
    const reply = OUTCOME_REPLIES[result.outcome]
    if (!reply) throw new EngineCallError('refused', 422, 'invalid_workflow_result')
    this.pending.delete(sessionId)
    return { reply, domain: 'college', intent: 'admission_status', outcome: 'workflow_result', steps: null, action: null }
  }

  async endSession(sessionId: string): Promise<boolean> {
    if (this.failEnd) throw new EngineCallError('unreachable')
    this.ended.push(sessionId)
    this.pending.delete(sessionId)
    return true
  }

  async synthesize(text: string, language: string): Promise<EngineSpeech> {
    this.spoken.push({ text, language })
    return { audio: Buffer.from('ID3-synthetic-audio'), contentType: 'audio/mpeg' }
  }
}

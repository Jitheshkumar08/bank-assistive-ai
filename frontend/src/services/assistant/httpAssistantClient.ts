import { api } from '@/api/client';
import { ApiError } from '@/types/api';
import type {
  AssistanceOffer,
  AssistantClient,
  AssistantReply,
  AssistantRequest,
  AssistantSnapshot,
  SpeechRequest,
  WorkflowState,
} from '@/types/assistant';

/**
 * How long a spoken turn may take.
 *
 * Speech recognition plus a language model is far slower than an
 * ordinary read, so the assistant asks for its own budget rather than
 * the client's 15-second default being raised for everything.
 */
const ASSISTANT_TIMEOUT_MS = 60_000;

interface AssistantResponseBody {
  reply: string;
  transcript?: string | null;
  workflow?: {
    name: string | null;
    state: string;
    step: number | null;
    totalSteps: number | null;
  } | null;
  ended?: boolean;
}

interface AssistantSnapshotBody {
  known?: unknown;
  ended?: unknown;
  workflow?: AssistantResponseBody['workflow'];
}

interface AssistanceBody {
  offered?: unknown;
  reason?: unknown;
  field?: unknown;
  promptId?: unknown;
  text?: unknown;
}

/**
 * The real assistant, reached through the Node API.
 *
 * The browser never talks to the Python engine: NestJS authenticates the
 * customer, confirms the visit is theirs, and forwards the turn. Typed
 * and spoken input differ only in which endpoint carries them -- both
 * end up in the same conversation on the other side.
 */
export class HttpAssistantClient implements AssistantClient {
  async sendMessage(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantReply> {
    const body =
      request.input.type === 'voice'
        ? this.voiceBody(request.sessionId, request.input.audio, request.input.mimeType)
        : { sessionId: request.sessionId, text: request.input.text };

    const path = request.input.type === 'voice' ? '/assistant/voice' : '/assistant/message';

    // sessionId is the only routing the server accepts from us; it
    // re-derives the language and branch context from the visit itself,
    // so a tampered client cannot talk into someone else's conversation.
    const response = await api.postSlow<AssistantResponseBody>(
      path,
      body,
      ASSISTANT_TIMEOUT_MS,
      signal,
    );

    return {
      reply: response.reply,
      transcript: response.transcript ?? null,
      workflow: response.workflow
        ? { ...response.workflow, state: toWorkflowState(response.workflow.state) }
        : null,
      ended: response.ended === true,
    };
  }

  /**
   * Fetches the spoken reply.
   *
   * Only the visit and the text are sent. The language is the server's
   * decision, taken from the visit, so the voice cannot be changed by a
   * tampered client.
   */
  async speak(request: SpeechRequest, signal?: AbortSignal): Promise<Blob> {
    return api.postForBlob(
      '/assistant/speak',
      { sessionId: request.sessionId, text: request.text },
      ASSISTANT_TIMEOUT_MS,
      signal,
    );
  }

  /**
   * Reads where the visit's conversation stands. The server changes nothing.
   *
   * Failures arrive as ApiError, as for every call: 409 while a turn is
   * still running, 403 for a visit that is no longer the customer's, 502 /
   * 504 when the assistant is unavailable. A body without an explicit
   * `known` flag is refused rather than read as "no workflow".
   */
  async getSnapshot(sessionId: string, signal?: AbortSignal): Promise<AssistantSnapshot> {
    const body = await api.get<AssistantSnapshotBody>(
      `/assistant/sessions/${encodeURIComponent(sessionId)}/snapshot`,
      signal,
    );

    if (!body || typeof body.known !== 'boolean') {
      throw new ApiError('The assistant could not report its progress.', 502);
    }

    return {
      known: body.known,
      ended: body.ended === true,
      // Unknown progress is never shown as a workflow, whatever came back.
      workflow:
        body.known && body.workflow
          ? { ...body.workflow, state: toWorkflowState(body.workflow.state) }
          : null,
    };
  }

  /**
   * Asks whether the customer, quiet on a step, should be offered help.
   *
   * Only the id of the last offer is sent, so the next one is worded
   * differently. Failures arrive as ApiError, like every call; the caller
   * treats them as "no offer" and never retries.
   */
  async requestAssistance(
    sessionId: string,
    avoid: string | null,
    signal?: AbortSignal,
  ): Promise<AssistanceOffer> {
    const body = await api.post<AssistanceBody>(
      `/assistant/sessions/${encodeURIComponent(sessionId)}/assistance`,
      avoid ? { avoid } : {},
      signal,
    );

    if (!body || typeof body.offered !== 'boolean') {
      throw new ApiError('The assistant could not offer help right now.', 502);
    }

    const text = typeof body.text === 'string' && body.text.trim() ? body.text : null;

    return {
      // An offer with nothing to say is not an offer.
      offered: body.offered && text !== null,
      reason: typeof body.reason === 'string' ? body.reason : 'unknown',
      field: typeof body.field === 'string' ? body.field : null,
      promptId: typeof body.promptId === 'string' ? body.promptId : null,
      text: body.offered ? text : null,
    };
  }

  private voiceBody(sessionId: string, audio: Blob, mimeType: string): FormData {
    const form = new FormData();

    form.append('sessionId', sessionId);
    // The extension only tells the decoder what it is looking at; the
    // server does not trust it for anything else.
    form.append('audio', audio, `utterance${extensionFor(mimeType)}`);

    return form;
  }
}

const WORKFLOW_STATES: WorkflowState[] = ['none', 'active', 'suspended', 'completed', 'cancelled'];

/** The engine sends a plain string; anything unrecognised means no workflow. */
function toWorkflowState(value: string): WorkflowState {
  return WORKFLOW_STATES.includes(value as WorkflowState) ? (value as WorkflowState) : 'none';
}

function extensionFor(mimeType: string): string {
  const type = (mimeType || '').toLowerCase();

  if (type.includes('webm')) return '.webm';
  if (type.includes('ogg')) return '.ogg';
  if (type.includes('mp4') || type.includes('m4a')) return '.m4a';
  if (type.includes('mpeg')) return '.mp3';
  if (type.includes('wav')) return '.wav';

  return '.webm';
}

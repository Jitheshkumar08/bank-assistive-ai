import { api } from '@/api/client';
import type {
  AssistantClient,
  AssistantReply,
  AssistantRequest,
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

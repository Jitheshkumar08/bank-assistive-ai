/**
 * The conversation contract.
 *
 * This is deliberately shaped like the request the Python engine will
 * eventually answer, routed through NestJS, so that swapping the mock
 * for the real service is a change of implementation rather than a
 * change of contract. Field names are camelCase because this side talks
 * to the Node API; the snake_case translation belongs at that boundary,
 * not here.
 */

export type MessageAuthor = 'user' | 'assistant';

/**
 * A user message is optimistic: it appears immediately, then either
 * settles or is marked failed. Assistant messages only ever arrive
 * settled, so they carry no status.
 */
export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ConversationMessage {
  id: string;
  author: MessageAuthor;
  content: string;
  /** ISO timestamp, set on the client. Not persisted anywhere yet. */
  at: string;
  status?: MessageStatus;
}

/**
 * Mirrors the engine's own WorkflowState enum.
 *
 * Carried on the reply so the UI can show task progress once workflows
 * are wired up. Nothing renders it yet -- it exists so adding that later
 * is additive rather than a contract change.
 */
export type WorkflowState = 'none' | 'active' | 'suspended' | 'completed' | 'cancelled';

export interface WorkflowSnapshot {
  name: string | null;
  state: WorkflowState;
  step: number | null;
  totalSteps: number | null;
}

/**
 * Text today, voice later.
 *
 * A discriminated union rather than a loose string so adding a voice
 * variant forces every call site to be revisited by the compiler
 * instead of failing silently at runtime.
 */
export type AssistantInput =
  | { type: 'text'; text: string }
  | { type: 'voice'; audio: Blob; mimeType: string };

export interface AssistantRequest {
  /** The application visit, not the engine's internal conversation. */
  sessionId: string;
  language: string;
  context: {
    branchCode: string;
  };
  input: AssistantInput;
}

export interface AssistantReply {
  /** What the assistant says back, already plain text and ready to show. */
  reply: string;
  /**
   * What speech recognition heard.
   *
   * Present only for a spoken turn, and shown as the customer's own
   * message -- so they can see what was understood, and correct it if it
   * was wrong.
   */
  transcript?: string | null;
  /** Where the banking task has reached, once workflows are wired up. */
  workflow?: WorkflowSnapshot | null;
  /** True when the customer asked to end the session. */
  ended?: boolean;
}

/**
 * The one seam between the conversation UI and whatever answers it.
 *
 * MockAssistantClient implements this now; an HTTP client calling
 * NestJS implements it later. No component imports either directly --
 * they go through the module that selects one, so the swap touches a
 * single file.
 */
export interface SpeechRequest {
  sessionId: string;
  /** The reply to read aloud. */
  text: string;
}

export interface AssistantClient {
  sendMessage(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantReply>;
  /**
   * Fetches the reply as audio for the browser to play.
   *
   * No language is sent: the visit already knows which language the
   * customer is being served in, and the server decides the voice from
   * it. Returns the audio as a Blob, which the playback layer turns into
   * an object URL and revokes when it is done.
   */
  speak(request: SpeechRequest, signal?: AbortSignal): Promise<Blob>;
}

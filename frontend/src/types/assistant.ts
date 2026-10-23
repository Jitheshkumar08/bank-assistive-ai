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
 * Carried on every reply; the conversation screen shows it as task
 * progress.
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
  /** Where the banking task has reached. */
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

/**
 * Where the visit's conversation stands, read without changing it.
 *
 * Used only to re-sync after a turn whose reply never arrived: the
 * assistant may have applied that turn anyway.
 */
export interface AssistantSnapshot {
  /**
   * False when the assistant holds no conversation for this visit. The
   * progress is then UNKNOWN -- which is not the same as "no workflow",
   * and must never be shown as one.
   */
  known: boolean;
  /** The customer ended the conversation. */
  ended: boolean;
  /** Same shape as a reply's workflow. Null whenever `known` is false. */
  workflow: WorkflowSnapshot | null;
}

/**
 * An offer of help for a customer who has gone quiet on a step, or why
 * there is none.
 *
 * The assistant decides whether an offer fits -- an active step, no
 * question waiting for an answer -- and words it in the visit's language.
 * An offer never moves the workflow.
 */
export interface AssistanceOffer {
  offered: boolean;
  /** offered, ended, pending_question, paused, no_active_step, unknown_session. */
  reason: string;
  /** The current step's field type, from the workflow definition. */
  field: string | null;
  /** Stable id of the wording; passed back so the next offer differs. */
  promptId: string | null;
  /** What to show and say. Null when nothing is offered. */
  text: string | null;
}

export interface AssistantClient {
  sendMessage(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantReply>;
  /**
   * Asks for an offer of help after a quiet spell. Optional: a client
   * without it (the offline mock) simply never offers.
   */
  requestAssistance?(
    sessionId: string,
    avoid: string | null,
    signal?: AbortSignal,
  ): Promise<AssistanceOffer>;
  /**
   * Reads the visit's workflow progress. Optional: a client without it
   * (the offline mock) simply never re-syncs, and nothing else changes.
   */
  getSnapshot?(sessionId: string, signal?: AbortSignal): Promise<AssistantSnapshot>;
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

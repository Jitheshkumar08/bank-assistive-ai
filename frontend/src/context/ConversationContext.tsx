import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { assistantClient } from '@/services/assistant';
import { useSession } from '@/context/useSession';
import { ApiError } from '@/types/api';
import type { AssistantInput, ConversationMessage, WorkflowSnapshot } from '@/types/assistant';

/** A reply the assistant has just delivered, and how its turn began. */
export interface DeliveredReply {
  text: string;
  /** Typed text or a recording -- whoever listens may treat them differently. */
  input: AssistantInput['type'];
}

export type ReplyListener = (reply: DeliveredReply) => void;

/** Stable enough for React keys; ids never leave the browser. */
function messageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface ConversationState {
  messages: ConversationMessage[];
  isSending: boolean;
  /** Set when the last send failed. Cleared by a successful send. */
  error: string | null;
  /** True when nothing has been said yet, so the page can show a welcome. */
  isEmpty: boolean;
  /** True when a failed message is waiting to be retried. */
  canRetry: boolean;
  /**
   * Where the banking task stands, as of the last reply.
   *
   * Replaced by every reply rather than merged: the engine reports the
   * whole state each turn, and a stale step must never outlive the
   * workflow it belonged to. Null until the first reply of a visit.
   */
  workflow: WorkflowSnapshot | null;
  /**
   * True once the assistant has said goodbye because the customer asked
   * to leave. The conversation accepts nothing more; what happens to the
   * visit is the page's decision.
   */
  ended: boolean;
  /** Resolves with the reply text, or null when the turn failed. */
  send: (content: string) => Promise<string | null>;
  /**
   * Sends a recording.
   *
   * Speech and typing are the same conversation: this differs from
   * send() only in what it hands the client, and the reply comes back
   * through the identical path.
   */
  sendVoice: (audio: Blob, mimeType: string) => Promise<string | null>;
  retry: () => Promise<void>;
  /**
   * Hears about every reply the assistant delivers, however the turn
   * began: typed, a suggestion, a retry, or speech.
   *
   * The conversation still knows nothing about voice. It announces that
   * a reply arrived and what kind of turn produced it; whoever cares
   * decides what to do with that. Returns the unsubscribe function.
   */
  subscribeToReplies: (listener: ReplyListener) => () => void;
}

export const ConversationContext = createContext<ConversationState | null>(null);

/**
 * Owns the conversation, for the whole app rather than one screen.
 *
 * This was a hook inside AssistantPage until voice arrived. Voice needs
 * to reach the same `send()` from the scan and welcome screens, and the
 * only way to guarantee there is exactly ONE conversation -- rather than
 * a text one and a voice one that drift apart -- is for both to read it
 * from here.
 *
 * The logic is unchanged from when it lived in the page: the assistant
 * is still reached only through the client seam, so this is untouched
 * when the real engine replaces the mock.
 *
 * Conversation state is in memory only. Nothing is persisted in this
 * phase, so a refresh starts a fresh conversation while the underlying
 * visit continues.
 */
export function ConversationProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(null);
  const [ended, setEnded] = useState(false);

  // A different visit is a different conversation. Without this, ending
  // one visit and scanning into the next would show the old messages and
  // keep the composer closed by the old goodbye. Keyed on the id, so
  // re-scanning within the same visit -- which keeps its id -- does not
  // wipe the conversation.
  const sessionId = session?.id ?? null;
  const [conversationOf, setConversationOf] = useState<string | null>(sessionId);

  if (conversationOf !== sessionId) {
    setConversationOf(sessionId);
    setMessages([]);
    setIsSending(false);
    setError(null);
    setWorkflow(null);
    setEnded(false);
  }

  // Held so a failed send can be retried without the customer retyping.
  const pendingRef = useRef<{ id: string; content: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Re-syncing after a failed turn. `turnRef` numbers every turn, so a
  // snapshot answers only the failure that asked for it: a newer turn, a
  // different visit or unmounting makes it stale, and stale is ignored.
  const turnRef = useRef(0);
  const visitRef = useRef(sessionId);
  visitRef.current = sessionId;
  const snapshotAbortRef = useRef<AbortController | null>(null);

  // A ref, not state: subscribing must never re-render the conversation,
  // and the set has to survive every render in between.
  const listenersRef = useRef(new Set<ReplyListener>());

  const subscribeToReplies = useCallback((listener: ReplyListener): (() => void) => {
    listenersRef.current.add(listener);

    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      snapshotAbortRef.current?.abort();
    };
  }, []);

  // A reply still in flight belongs to the visit it was sent in, and a
  // failed message cannot be retried into a different one. Nor can a
  // re-sync for one visit land in another.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      snapshotAbortRef.current?.abort();
      pendingRef.current = null;
    };
  }, [sessionId]);

  /**
   * After a failed or timed-out turn, asks once where the visit stands.
   *
   * The turn may have been applied even though its reply never arrived --
   * a timeout in particular says nothing about what the assistant did. So
   * the progress shown is refreshed from the assistant's own account,
   * which is the only authority on it.
   *
   * One request, never a retry and never a poll. Applied only if it still
   * answers the latest turn of the same visit. Unknown progress, a turn
   * still running (409) or any failure leaves the last known state exactly
   * as it was: progress is never invented, and "unknown" is never shown as
   * "no workflow". Reads only -- nothing is resent, re-recognised or
   * controlled.
   */
  const resync = useCallback(async (turn: number, visitId: string): Promise<void> => {
    // A client without snapshots (the offline mock) just does not re-sync.
    if (typeof assistantClient.getSnapshot !== 'function') return;

    snapshotAbortRef.current?.abort();
    const controller = new AbortController();
    snapshotAbortRef.current = controller;

    let snapshot;

    try {
      snapshot = await assistantClient.getSnapshot(visitId, controller.signal);
    } catch {
      // The turn's own error is already on screen; this is not a second one.
      return;
    }

    const stale =
      controller.signal.aborted || turnRef.current !== turn || visitRef.current !== visitId;

    if (stale || !snapshot.known) return;

    if (snapshot.workflow) setWorkflow(snapshot.workflow);
    if (snapshot.ended) setEnded(true);
  }, []);

  const deliver = useCallback(
    async (userMessageId: string, input: AssistantInput): Promise<string | null> => {
      if (!session) return null;

      // A new turn supersedes any re-sync still out for an older one.
      const turn = ++turnRef.current;
      snapshotAbortRef.current?.abort();

      setIsSending(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const {
          reply,
          transcript,
          workflow: nextWorkflow,
          ended: visitEnded,
        } = await assistantClient.sendMessage(
          {
            sessionId: session.id,
            language: session.language,
            context: { branchCode: session.branch.code },
            input,
          },
          controller.signal,
        );

        if (controller.signal.aborted) return null;

        pendingRef.current = null;

        setWorkflow(nextWorkflow ?? null);

        if (visitEnded === true) setEnded(true);

        setMessages((current) => [
          ...current.map((message) =>
            message.id === userMessageId
              ? {
                  ...message,
                  // Showing what speech recognition heard lets the
                  // customer see when it misheard them.
                  content: transcript?.trim() ? transcript.trim() : message.content,
                  status: 'sent' as const,
                }
              : message,
          ),
          {
            id: messageId(),
            author: 'assistant',
            content: reply,
            at: new Date().toISOString(),
          },
        ]);

        // Announced after the update is queued, never inside the updater
        // above: React may run an updater twice, and a listener called
        // from in there would read the same reply aloud twice.
        for (const listener of listenersRef.current) {
          try {
            listener({ text: reply, input: input.type });
          } catch {
            // A listener's failure is its own. The reply is delivered and
            // on screen either way.
          }
        }

        // Also handed back directly, for the caller that started the turn.
        return reply;
      } catch (caught) {
        // Unmounting mid-request is not a failure the customer should see.
        if (isAbort(caught) || controller.signal.aborted) return null;

        // Only a typed message can be retried. A recording is discarded
        // as soon as it has been sent, so there is nothing to resend --
        // the customer speaks again instead.
        pendingRef.current =
          input.type === 'text' ? { id: userMessageId, content: input.text } : null;

        // The message stays on screen marked as failed, so nothing the
        // customer typed is lost when the connection drops.
        setMessages((current) =>
          current.map((message) =>
            message.id === userMessageId ? { ...message, status: 'failed' as const } : message,
          ),
        );

        setError(
          caught instanceof ApiError
            ? caught.message
            : 'I could not send that message. Please try again.',
        );

        // The assistant may have acted on this turn anyway. Ask once.
        void resync(turn, session.id);

        return null;
      } finally {
        if (!controller.signal.aborted) setIsSending(false);
      }
    },
    [session, resync],
  );

  const send = useCallback(
    async (content: string): Promise<string | null> => {
      const trimmed = content.trim();

      // Whitespace is not a question. Silently ignoring it is kinder than
      // an error, because the only way to reach here is an accidental tap.
      // After the goodbye there is no one listening on the other side.
      if (!trimmed || isSending || ended) return null;

      const id = messageId();

      setMessages((current) => [
        ...current,
        { id, author: 'user', content: trimmed, at: new Date().toISOString(), status: 'sending' },
      ]);

      return deliver(id, { type: 'text', text: trimmed });
    },
    [deliver, isSending, ended],
  );

  const sendVoice = useCallback(
    async (audio: Blob, mimeType: string): Promise<string | null> => {
      if (isSending || ended || audio.size === 0) return null;

      const id = messageId();

      // A placeholder stands in until the transcript arrives, so the
      // customer can see their turn was registered while it is being
      // understood.
      setMessages((current) => [
        ...current,
        {
          id,
          author: 'user',
          content: 'Voice message',
          at: new Date().toISOString(),
          status: 'sending',
        },
      ]);

      return deliver(id, { type: 'voice', audio, mimeType });
    },
    [deliver, isSending, ended],
  );

  const retry = useCallback(async (): Promise<void> => {
    const pending = pendingRef.current;

    if (!pending || isSending) return;


    setMessages((current) =>
      current.map((message) =>
        message.id === pending.id ? { ...message, status: 'sending' as const } : message,
      ),
    );

    await deliver(pending.id, { type: 'text', text: pending.content });
  }, [deliver, isSending]);

  const value: ConversationState = {
    messages,
    isSending,
    error,
    isEmpty: messages.length === 0,
    canRetry: error !== null && pendingRef.current !== null,
    workflow,
    ended,
    send,
    sendVoice,
    retry,
    subscribeToReplies,
  };

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

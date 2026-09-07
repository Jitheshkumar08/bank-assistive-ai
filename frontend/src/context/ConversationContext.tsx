import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { assistantClient } from '@/services/assistant';
import { useSession } from '@/context/useSession';
import { ApiError } from '@/types/api';
import type { AssistantInput, ConversationMessage } from '@/types/assistant';

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

  // Held so a failed send can be retried without the customer retyping.
  const pendingRef = useRef<{ id: string; content: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const deliver = useCallback(
    async (userMessageId: string, input: AssistantInput): Promise<string | null> => {
      if (!session) return null;

      setIsSending(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const { reply, transcript } = await assistantClient.sendMessage(
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

        // Handed back so voice can read it aloud. The conversation still
        // owns the messages; this is only the text of this turn's reply.
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

        return null;
      } finally {
        if (!controller.signal.aborted) setIsSending(false);
      }
    },
    [session],
  );

  const send = useCallback(
    async (content: string): Promise<string | null> => {
      const trimmed = content.trim();

      // Whitespace is not a question. Silently ignoring it is kinder than
      // an error, because the only way to reach here is an accidental tap.
      if (!trimmed || isSending) return null;

      const id = messageId();

      setMessages((current) => [
        ...current,
        { id, author: 'user', content: trimmed, at: new Date().toISOString(), status: 'sending' },
      ]);

      return deliver(id, { type: 'text', text: trimmed });
    },
    [deliver, isSending],
  );

  const sendVoice = useCallback(
    async (audio: Blob, mimeType: string): Promise<string | null> => {
      if (isSending || audio.size === 0) return null;

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
    [deliver, isSending],
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
    send,
    sendVoice,
    retry,
  };

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

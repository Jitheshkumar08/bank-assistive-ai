import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationProvider, type DeliveredReply } from './ConversationContext';
import { useConversation } from './useConversation';
import { SessionContext, type SessionContextValue } from './SessionContext';
import { ApiError } from '@/types/api';
import type { AssistantRequest } from '@/types/assistant';
import type { Session } from '@/types/session';

const sendMessage = vi.fn();

vi.mock('@/services/assistant', () => ({
  assistantClient: { sendMessage: (...args: unknown[]) => sendMessage(...args) },
}));

const SESSION: Session = {
  id: 'sess-1',
  status: 'ACTIVE',
  language: 'kn',
  startedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  endedAt: null,
  branch: { id: 'b1', code: 'BR001', name: 'Surathkal Branch', city: 'Mangaluru' },
};

const session: SessionContextValue = {
  session: SESSION,
  isLoading: false,
  hasContext: true,
  error: null,
  refresh: async () => {},
  establish: async () => SESSION,
  endSession: async () => {},
  arrivalAt: null,
  acknowledgeArrival: () => {},
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SessionContext.Provider value={session}>
      <ConversationProvider>{children}</ConversationProvider>
    </SessionContext.Provider>
  );
}

const render = () => renderHook(() => useConversation(), { wrapper });

const audio = () => new Blob([new Uint8Array(256)], { type: 'audio/webm' });

describe('ConversationProvider', () => {
  beforeEach(() => {
    sendMessage.mockReset().mockResolvedValue({ reply: 'Please take a withdrawal slip.' });
  });

  describe('one pipeline for both modalities', () => {
    it('sends a typed turn as text', async () => {
      const { result } = render();

      await act(() => result.current.send('I want to withdraw money'));

      const request = sendMessage.mock.calls[0][0] as AssistantRequest;
      expect(request.input).toEqual({ type: 'text', text: 'I want to withdraw money' });
    });

    it('sends a spoken turn as audio through the same client', async () => {
      const { result } = render();

      await act(() => result.current.sendVoice(audio(), 'audio/webm'));

      const request = sendMessage.mock.calls[0][0] as AssistantRequest;
      expect(request.input.type).toBe('voice');
      // Same session, same language, same context object -- one
      // conversation, not a parallel voice one.
      expect(request.sessionId).toBe('sess-1');
      expect(request.language).toBe('kn');
      expect(request.context).toEqual({ branchCode: 'BR001' });
    });

    it('carries the visit language rather than a hard-coded one', async () => {
      const { result } = render();

      await act(() => result.current.send('hello'));

      expect((sendMessage.mock.calls[0][0] as AssistantRequest).language).toBe('kn');
    });
  });

  describe('a spoken turn', () => {
    it('shows the transcript as the customer’s own message', async () => {
      sendMessage.mockResolvedValue({
        reply: 'Please take a withdrawal slip.',
        transcript: 'I want to withdraw money',
      });

      const { result } = render();
      await act(() => result.current.sendVoice(audio(), 'audio/webm'));

      await waitFor(() => expect(result.current.messages).toHaveLength(2));

      const [spoken, answer] = result.current.messages;
      // The placeholder is replaced, so the customer can see what was
      // understood and correct it if it was wrong.
      expect(spoken.author).toBe('user');
      expect(spoken.content).toBe('I want to withdraw money');
      expect(spoken.status).toBe('sent');
      expect(answer.author).toBe('assistant');
      expect(answer.content).toBe('Please take a withdrawal slip.');
    });

    it('keeps the placeholder when nothing was transcribed', async () => {
      sendMessage.mockResolvedValue({ reply: 'Sorry?', transcript: '   ' });

      const { result } = render();
      await act(() => result.current.sendVoice(audio(), 'audio/webm'));

      await waitFor(() => expect(result.current.messages).toHaveLength(2));
      expect(result.current.messages[0].content).toBe('Voice message');
    });

    it('ignores an empty recording', async () => {
      const { result } = render();

      await act(() => result.current.sendVoice(new Blob([], { type: 'audio/webm' }), 'audio/webm'));

      expect(sendMessage).not.toHaveBeenCalled();
      expect(result.current.messages).toHaveLength(0);
    });

    it('marks a failed recording without offering to resend it', async () => {
      sendMessage.mockRejectedValue(new ApiError('The assistant is unavailable.', 502));

      const { result } = render();
      await act(() => result.current.sendVoice(audio(), 'audio/webm'));

      await waitFor(() => expect(result.current.error).toMatch(/unavailable/i));
      expect(result.current.messages[0].status).toBe('failed');
      // The audio is gone, so there is nothing to retry -- the customer
      // speaks again instead.
      expect(result.current.canRetry).toBe(false);
    });

    it('shows a 422 as the reason, sends once, and is ready for the next turn', async () => {
      sendMessage.mockRejectedValueOnce(
        new ApiError('I could not hear anything in that recording.', 422),
      );

      const { result } = render();
      await act(() => result.current.sendVoice(audio(), 'audio/webm'));

      expect(result.current.error).toBe('I could not hear anything in that recording.');
      expect(result.current.messages[0].status).toBe('failed');
      expect(result.current.canRetry).toBe(false);
      expect(result.current.isSending).toBe(false);
      expect(sendMessage).toHaveBeenCalledTimes(1);

      // Speaking again is a fresh turn, and it goes through.
      await act(() => result.current.sendVoice(audio(), 'audio/webm'));
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(result.current.error).toBeNull();
    });
  });

  describe('announcing replies', () => {
    it('announces a typed reply, and says it was typed', async () => {
      const { result } = render();
      const heard: DeliveredReply[] = [];
      act(() => {
        result.current.subscribeToReplies((reply) => heard.push(reply));
      });

      await act(() => result.current.send('I want to withdraw money'));

      expect(heard).toEqual([{ text: 'Please take a withdrawal slip.', input: 'text', workflow: null }]);
    });

    it('announces a spoken reply, and says it was spoken', async () => {
      const { result } = render();
      const heard: DeliveredReply[] = [];
      act(() => {
        result.current.subscribeToReplies((reply) => heard.push(reply));
      });

      await act(() => result.current.sendVoice(audio(), 'audio/webm'));

      // Voice decides for itself what to do with a spoken turn's reply,
      // and can only do that if it is told which kind of turn this was.
      expect(heard).toEqual([{ text: 'Please take a withdrawal slip.', input: 'voice', workflow: null }]);
    });

    it('announces nothing for a failed turn, then the reply once a retry succeeds', async () => {
      sendMessage.mockRejectedValueOnce(new ApiError('Service unavailable.', 503));

      const { result } = render();
      const heard: DeliveredReply[] = [];
      act(() => {
        result.current.subscribeToReplies((reply) => heard.push(reply));
      });

      await act(() => result.current.send('I want to withdraw money'));
      expect(heard).toEqual([]);

      await act(() => result.current.retry());
      expect(heard).toEqual([{ text: 'Please take a withdrawal slip.', input: 'text', workflow: null }]);
    });

    it('stops announcing once unsubscribed', async () => {
      const { result } = render();
      const heard: DeliveredReply[] = [];
      let unsubscribe!: () => void;
      act(() => {
        unsubscribe = result.current.subscribeToReplies((reply) => heard.push(reply));
      });

      act(() => unsubscribe());
      await act(() => result.current.send('I want to withdraw money'));

      expect(heard).toEqual([]);
    });

    it('announces each reply exactly once, even under StrictMode', async () => {
      function strictWrapper({ children }: { children: ReactNode }) {
        return (
          <StrictMode>
            <SessionContext.Provider value={session}>
              <ConversationProvider>{children}</ConversationProvider>
            </SessionContext.Provider>
          </StrictMode>
        );
      }

      const { result } = renderHook(() => useConversation(), { wrapper: strictWrapper });
      const heard: DeliveredReply[] = [];
      act(() => {
        result.current.subscribeToReplies((reply) => heard.push(reply));
      });

      await act(() => result.current.send('I want to withdraw money'));

      // StrictMode runs state updaters twice on purpose. A listener called
      // from inside one would read the same reply aloud twice.
      expect(heard).toHaveLength(1);
    });

    it('still delivers the reply when a listener throws', async () => {
      const { result } = render();
      act(() => {
        result.current.subscribeToReplies(() => {
          throw new Error('listener broke');
        });
      });

      let reply: string | null = null;
      await act(async () => {
        reply = await result.current.send('I want to withdraw money');
      });

      expect(reply).toBe('Please take a withdrawal slip.');
      const messages = result.current.messages;
      expect(messages[messages.length - 1].content).toBe('Please take a withdrawal slip.');
    });
  });

  describe('a typed turn still behaves as before', () => {
    it('can be retried after a failure', async () => {
      sendMessage.mockRejectedValueOnce(new ApiError('Cannot reach the server.', 0));

      const { result } = render();
      await act(() => result.current.send('I want to deposit money'));

      await waitFor(() => expect(result.current.canRetry).toBe(true));

      sendMessage.mockResolvedValueOnce({ reply: 'Please take a deposit slip.' });
      await act(() => result.current.retry());

      await waitFor(() => expect(result.current.messages).toHaveLength(2));
      expect(result.current.error).toBeNull();
      expect(
        (sendMessage.mock.calls[1][0] as AssistantRequest).input,
      ).toEqual({ type: 'text', text: 'I want to deposit money' });
    });

    it('keeps both modalities in one growing conversation', async () => {
      const { result } = render();

      sendMessage.mockResolvedValueOnce({ reply: 'Please take a withdrawal slip.' });
      await act(() => result.current.send('I want to withdraw money'));

      sendMessage.mockResolvedValueOnce({
        reply: 'Fill in your account number.',
        transcript: 'I have the slip',
      });
      await act(() => result.current.sendVoice(audio(), 'audio/webm'));

      await waitFor(() => expect(result.current.messages).toHaveLength(4));

      // A typed turn and a spoken turn, in order, in one conversation.
      expect(result.current.messages.map((m) => m.content)).toEqual([
        'I want to withdraw money',
        'Please take a withdrawal slip.',
        'I have the slip',
        'Fill in your account number.',
      ]);
    });
  });
});

describe('ConversationProvider -- workflow and the end of a visit', () => {
  const DEPOSIT_STEP_1 = {
    reply: 'Please take a deposit slip.',
    workflow: { name: 'deposit money', state: 'active', step: 1, totalSteps: 4 },
    ended: false,
  };

  /** Lets a test swap the visit, as a new scan would. */
  function renderWithSession(initial: SessionContextValue) {
    let current = initial;

    const view = renderHook(() => useConversation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SessionContext.Provider value={current}>
          <ConversationProvider>{children}</ConversationProvider>
        </SessionContext.Provider>
      ),
    });

    return {
      ...view,
      switchTo(next: SessionContextValue) {
        current = next;
        view.rerender();
      },
    };
  }

  beforeEach(() => {
    sendMessage.mockReset();
  });

  it('starts with no workflow and not ended', () => {
    const { result } = render();

    expect(result.current.workflow).toBeNull();
    expect(result.current.ended).toBe(false);
  });

  it('takes the workflow from each reply', async () => {
    sendMessage.mockResolvedValueOnce(DEPOSIT_STEP_1).mockResolvedValueOnce({
      reply: 'Fill in your account number.',
      workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
    });

    const { result } = render();

    await act(() => result.current.send('I want to deposit money'));
    expect(result.current.workflow).toEqual(DEPOSIT_STEP_1.workflow);

    await act(() => result.current.send('done'));
    expect(result.current.workflow).toEqual({
      name: 'deposit money',
      state: 'active',
      step: 2,
      totalSteps: 4,
    });
  });

  it('replaces the workflow when it completes, without ending the visit', async () => {
    sendMessage.mockResolvedValueOnce(DEPOSIT_STEP_1).mockResolvedValueOnce({
      reply: 'Workflow Completed.',
      workflow: { name: 'deposit money', state: 'completed', step: 5, totalSteps: 4 },
      ended: false,
    });

    const { result } = render();

    await act(() => result.current.send('I want to deposit money'));
    await act(() => result.current.send('submitted'));

    expect(result.current.workflow?.state).toBe('completed');
    // Completing a task never ends the visit.
    expect(result.current.ended).toBe(false);
  });

  it('clears the workflow when a reply carries none', async () => {
    sendMessage
      .mockResolvedValueOnce(DEPOSIT_STEP_1)
      .mockResolvedValueOnce({ reply: 'A cheque book is a set of cheques.' });

    const { result } = render();

    await act(() => result.current.send('I want to deposit money'));
    await act(() => result.current.send('what is a cheque book'));

    expect(result.current.workflow).toBeNull();
  });

  it('keeps the last known workflow when a turn fails', async () => {
    sendMessage
      .mockResolvedValueOnce(DEPOSIT_STEP_1)
      .mockRejectedValueOnce(new ApiError('The assistant is temporarily unavailable.', 502));

    const { result } = render();

    await act(() => result.current.send('I want to deposit money'));
    await act(() => result.current.send('next'));

    expect(result.current.workflow).toEqual(DEPOSIT_STEP_1.workflow);
    expect(result.current.ended).toBe(false);
  });

  it('marks the conversation ended and keeps the goodbye', async () => {
    sendMessage.mockResolvedValueOnce({
      reply: 'Thank you for using the banking assistant.',
      workflow: { name: null, state: 'none', step: null, totalSteps: null },
      ended: true,
    });

    const { result } = render();

    await act(() => result.current.send('exit'));

    expect(result.current.ended).toBe(true);
    expect(result.current.messages.at(-1)?.content).toBe(
      'Thank you for using the banking assistant.',
    );
  });

  it('accepts nothing more once ended, typed or spoken', async () => {
    sendMessage.mockResolvedValueOnce({ reply: 'Goodbye.', ended: true });

    const { result } = render();

    await act(() => result.current.send('exit'));
    sendMessage.mockClear();

    let typed: string | null = 'unset';
    let spoken: string | null = 'unset';

    await act(async () => {
      typed = await result.current.send('one more thing');
      spoken = await result.current.sendVoice(audio(), 'audio/webm');
    });

    expect(typed).toBeNull();
    expect(spoken).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(2);
  });

  it('starts afresh for a new visit', async () => {
    sendMessage.mockResolvedValueOnce({ reply: 'Goodbye.', ended: true });

    const { result, switchTo } = renderWithSession(session);

    await act(() => result.current.send('exit'));
    expect(result.current.ended).toBe(true);

    switchTo({ ...session, session: { ...SESSION, id: 'sess-2' } });

    expect(result.current.ended).toBe(false);
    expect(result.current.workflow).toBeNull();
    expect(result.current.messages).toEqual([]);

    sendMessage.mockResolvedValueOnce({ reply: 'Hello again.' });
    await act(() => result.current.send('hello'));

    expect((sendMessage.mock.calls.at(-1)?.[0] as AssistantRequest).sessionId).toBe('sess-2');
  });

  it('keeps the conversation when the same visit is re-scanned', async () => {
    sendMessage.mockResolvedValueOnce(DEPOSIT_STEP_1);

    const { result, switchTo } = renderWithSession(session);

    await act(() => result.current.send('I want to deposit money'));

    // Same id, new branch: the visit moved, it did not restart.
    switchTo({
      ...session,
      session: { ...SESSION, branch: { ...SESSION.branch, code: 'BR002' } },
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.workflow).toEqual(DEPOSIT_STEP_1.workflow);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationProvider } from './ConversationContext';
import { useConversation } from './useConversation';
import { SessionContext, type SessionContextValue } from './SessionContext';
import { ApiError } from '@/types/api';
import type { AssistantSnapshot, WorkflowSnapshot } from '@/types/assistant';
import type { Session } from '@/types/session';

/**
 * Re-syncing workflow progress after a failed turn (P4 frontend).
 *
 * Real: ConversationProvider. Stand-in: the assistant client. These prove
 * when a snapshot is asked for, when its answer is applied, and that
 * recovery only ever READS -- nothing is resent, re-recognised or retried.
 * They do not exercise the real NestJS endpoint or a real timeout.
 */

const sendMessage = vi.fn();
const getSnapshot = vi.fn();

vi.mock('@/services/assistant', () => ({
  assistantClient: {
    sendMessage: (...args: unknown[]) => sendMessage(...args),
    getSnapshot: (...args: unknown[]) => getSnapshot(...args),
  },
}));

function visit(id: string): Session {
  return {
    id,
    status: 'ACTIVE',
    language: 'kn',
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    endedAt: null,
    branch: { id: 'b1', code: 'BR001', name: 'Surathkal Branch', city: 'Mangaluru' },
  };
}

/** Mutable, so a test can switch visits and re-render. */
let current: Session = visit('sess-1');

function wrapper({ children }: { children: ReactNode }) {
  const value: SessionContextValue = {
    session: current,
    isLoading: false,
    hasContext: true,
    error: null,
    refresh: async () => {},
    establish: async () => current,
    endSession: async () => {},
    arrivalAt: null,
    acknowledgeArrival: () => {},
  };
  return (
    <SessionContext.Provider value={value}>
      <ConversationProvider>{children}</ConversationProvider>
    </SessionContext.Provider>
  );
}

const render = () => renderHook(() => useConversation(), { wrapper });

const workflow = (overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot => ({
  name: 'deposit money',
  state: 'active',
  step: 1,
  totalSteps: 4,
  ...overrides,
});

const known = (wf: WorkflowSnapshot, ended = false): AssistantSnapshot => ({
  known: true,
  ended,
  workflow: wf,
});

const UNKNOWN: AssistantSnapshot = { known: false, ended: false, workflow: null };

const BAD_GATEWAY = new ApiError('The assistant could not handle that request. Please try again.', 502);
const TIMED_OUT = new ApiError('The server took too long to respond. Please try again.', 0);

/** Lets any pending re-sync settle. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

/** A first, successful turn that leaves the deposit at step 1. */
async function atStepOne(result: ReturnType<typeof render>['result']) {
  sendMessage.mockResolvedValueOnce({ reply: 'Please take a deposit slip.', workflow: workflow() });
  await act(() => result.current.send('I want to deposit money'));
  expect(result.current.workflow).toEqual(workflow());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('re-syncing workflow progress after a failed turn', () => {
  beforeEach(() => {
    current = visit('sess-1');
    sendMessage.mockReset();
    getSnapshot.mockReset().mockResolvedValue(UNKNOWN);
  });

  describe('when a snapshot is requested', () => {
    it('never after a successful turn', async () => {
      const { result } = render();
      await atStepOne(result);
      await settle();

      expect(getSnapshot).not.toHaveBeenCalled();
    });

    it.each([
      ['a failed turn', BAD_GATEWAY],
      ['a timed-out turn', TIMED_OUT],
      ['a dropped connection', new TypeError('Failed to fetch')],
    ])('exactly once after %s, for this visit', async (_label, failure) => {
      const { result } = render();
      sendMessage.mockRejectedValueOnce(failure);

      await act(() => result.current.send('I filled in my account number'));
      await settle();
      await settle();

      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(getSnapshot.mock.calls[0][0]).toBe('sess-1');
      expect(getSnapshot.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    });

    it('once per failed request -- a second failure asks again, once', async () => {
      const { result } = render();
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY).mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('first'));
      await settle();
      await act(() => result.current.retry());
      await settle();

      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(getSnapshot).toHaveBeenCalledTimes(2);
    });

    it('not when the request was abandoned (unmount), which is not a failure', async () => {
      const pending = deferred<never>();
      sendMessage.mockReturnValueOnce(pending.promise);
      const { result, unmount } = render();

      act(() => void result.current.send('hello'));
      unmount();
      await settle();

      expect(getSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('applying the answer', () => {
    it('a known snapshot replaces the progress shown -- the turn was applied after all', async () => {
      const { result } = render();
      await atStepOne(result);
      getSnapshot.mockResolvedValueOnce(known(workflow({ step: 2 })));
      sendMessage.mockRejectedValueOnce(TIMED_OUT);

      await act(() => result.current.send('I took the slip'));

      await waitFor(() => expect(result.current.workflow).toEqual(workflow({ step: 2 })));
      // The turn's own error still stands: its reply never arrived.
      expect(result.current.error).toMatch(/too long/i);
    });

    it.each([
      ['paused', workflow({ state: 'suspended', step: 2 })],
      ['cancelled', workflow({ state: 'cancelled' })],
      ['no workflow', { name: null, state: 'none', step: null, totalSteps: null } as WorkflowSnapshot],
    ])('a known %s state is shown as reported', async (_label, reported) => {
      const { result } = render();
      await atStepOne(result);
      getSnapshot.mockResolvedValueOnce(known(reported));
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('cancel'));

      await waitFor(() => expect(result.current.workflow).toEqual(reported));
    });

    it('a known ended visit closes the conversation', async () => {
      const { result } = render();
      await atStepOne(result);
      getSnapshot.mockResolvedValueOnce(known(workflow(), true));
      sendMessage.mockRejectedValueOnce(TIMED_OUT);

      await act(() => result.current.send('exit'));

      await waitFor(() => expect(result.current.ended).toBe(true));
      expect(result.current.workflow).toEqual(workflow());
    });

    it('an unknown snapshot keeps the last known progress -- unknown is not "no workflow"', async () => {
      const { result } = render();
      await atStepOne(result);
      getSnapshot.mockResolvedValueOnce(UNKNOWN);
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('next'));
      await settle();

      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(result.current.workflow).toEqual(workflow());
      expect(result.current.ended).toBe(false);
    });

    it('never applies a workflow from an unknown snapshot, even if one came with it', async () => {
      const { result } = render();
      await atStepOne(result);
      getSnapshot.mockResolvedValueOnce({ known: false, ended: true, workflow: workflow({ step: 4 }) });
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('next'));
      await settle();

      expect(result.current.workflow).toEqual(workflow());
      expect(result.current.ended).toBe(false);
    });

    it.each([
      ['the snapshot request fails', new ApiError('The assistant could not report its progress.', 502)],
      ['the assistant is unreachable', new ApiError('Cannot reach the server.', 0)],
    ])('keeps the last known progress when %s', async (_label, failure) => {
      const { result } = render();
      await atStepOne(result);
      getSnapshot.mockRejectedValueOnce(failure);
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('next'));
      await settle();

      expect(result.current.workflow).toEqual(workflow());
      // Only the turn's error is shown; the snapshot failure adds nothing.
      expect(result.current.error).toBe(BAD_GATEWAY.message);
    });

    it('a 409 (turn still running) keeps the last state and is not retried', async () => {
      const { result } = render();
      await atStepOne(result);
      getSnapshot.mockRejectedValue(
        new ApiError('The assistant is still working on the last request.', 409),
      );
      sendMessage.mockRejectedValueOnce(TIMED_OUT);

      await act(() => result.current.send('I filled it'));
      for (let i = 0; i < 5; i += 1) await settle();

      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(result.current.workflow).toEqual(workflow());
    });
  });

  describe('stale answers are ignored', () => {
    it('after a newer request, which also cancels the stale one', async () => {
      const { result } = render();
      await atStepOne(result);
      const late = deferred<AssistantSnapshot>();
      getSnapshot.mockReturnValueOnce(late.promise);
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('first'));
      const signal = getSnapshot.mock.calls[0][1] as AbortSignal;

      // The customer carries on; that turn succeeds at step 3.
      sendMessage.mockResolvedValueOnce({ reply: 'ok', workflow: workflow({ step: 3 }) });
      await act(() => result.current.send('second'));
      expect(signal.aborted).toBe(true);

      // The old snapshot answers late with step 2. It must not win.
      await act(async () => late.resolve(known(workflow({ step: 2 }))));
      await settle();

      expect(result.current.workflow).toEqual(workflow({ step: 3 }));
    });

    it('after the visit changes', async () => {
      const { result, rerender } = render();
      await atStepOne(result);
      const late = deferred<AssistantSnapshot>();
      getSnapshot.mockReturnValueOnce(late.promise);
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('first'));
      const signal = getSnapshot.mock.calls[0][1] as AbortSignal;

      current = visit('sess-2');
      rerender();
      expect(signal.aborted).toBe(true);

      await act(async () => late.resolve(known(workflow({ step: 4 }), true)));
      await settle();

      // The new visit starts clean; nothing from the old one lands in it.
      expect(result.current.workflow).toBeNull();
      expect(result.current.ended).toBe(false);
    });

    it('after unmounting, without errors', async () => {
      const { result, unmount } = render();
      const late = deferred<AssistantSnapshot>();
      getSnapshot.mockReturnValueOnce(late.promise);
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('first'));
      const signal = getSnapshot.mock.calls[0][1] as AbortSignal;

      unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => late.resolve(known(workflow({ step: 2 }))));
    });
  });

  describe('recovery only reads', () => {
    it('a failed voice turn is neither resubmitted nor offered for retry', async () => {
      const { result } = render();
      getSnapshot.mockResolvedValueOnce(known(workflow({ step: 2 })));
      sendMessage.mockRejectedValueOnce(TIMED_OUT);

      const audio = new Blob([new Uint8Array(256)], { type: 'audio/webm' });
      await act(() => result.current.sendVoice(audio, 'audio/webm'));
      await waitFor(() => expect(result.current.workflow).toEqual(workflow({ step: 2 })));
      await settle();

      // One upload, ever. The snapshot carries the visit id and nothing else.
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(getSnapshot.mock.calls[0]).toHaveLength(2);
      expect(result.current.canRetry).toBe(false);
    });

    it('a failed typed turn is not resent by recovery; retry stays the customer’s choice', async () => {
      const { result } = render();
      sendMessage.mockRejectedValueOnce(BAD_GATEWAY);

      await act(() => result.current.send('I want to withdraw money'));
      await settle();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(result.current.canRetry).toBe(true);
    });
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_INACTIVITY_MS, resolveInactivityMs } from '@/lib/assistanceConfig';
import type { AssistanceOffer, WorkflowSnapshot } from '@/types/assistant';
import {
  useProactiveAssistance,
  type ProactiveAssistanceOptions,
} from './useProactiveAssistance';

/**
 * The inactivity controller, with fake timers and a scripted client.
 *
 * Nothing here talks to a server, a microphone or a speaker: the client is
 * a mock, voice activity is just a value. What is proven is WHEN the
 * controller asks, how often, and that it never does anything but ask.
 */

const ACCOUNT_STEP: WorkflowSnapshot = { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 };

function offer(promptId: string, text = `offer ${promptId}`): AssistanceOffer {
  return { offered: true, reason: 'offered', field: 'account_number', promptId, text };
}

let requestAssistance: Mock<(...args: unknown[]) => Promise<AssistanceOffer>>;
let onOffer: Mock<(...args: unknown[]) => void>;

function base(overrides: Partial<ProactiveAssistanceOptions> = {}): ProactiveAssistanceOptions {
  return {
    sessionId: 'sess-1',
    workflow: ACCOUNT_STEP,
    isSending: false,
    ended: false,
    voiceActivity: 'idle',
    micStatus: 'idle',
    turnKey: 2,
    client: { requestAssistance: (...args: unknown[]) => requestAssistance(...args) },
    onOffer: (...args: unknown[]) => onOffer(...args),
    ...overrides,
  };
}

function setup(overrides: Partial<ProactiveAssistanceOptions> = {}) {
  return renderHook((props: ProactiveAssistanceOptions) => useProactiveAssistance(props), {
    initialProps: base(overrides),
  });
}

/** Advances fake time and lets the resolved request settle. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  requestAssistance = vi.fn().mockResolvedValue(offer('account_number.1'));
  onOffer = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the threshold', () => {
  it('is 12 seconds by default', () => {
    expect(DEFAULT_INACTIVITY_MS).toBe(12_000);
  });

  it('asks exactly at 12 seconds of quiet, not before', async () => {
    setup();

    await wait(11_999);
    expect(requestAssistance).not.toHaveBeenCalled();

    await wait(1);
    expect(requestAssistance).toHaveBeenCalledTimes(1);
    expect(requestAssistance).toHaveBeenCalledWith('sess-1', null, expect.any(AbortSignal));
  });

  it('honours a configured threshold', async () => {
    setup({ thresholdMs: 5_000 });

    await wait(5_000);
    expect(requestAssistance).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, 12_000],
    ['20000', 20_000],
    [' 8000 ', 8_000],
    ['1000', 12_000],
    ['999999', 12_000],
    ['soon', 12_000],
    [Number.NaN, 12_000],
  ])('configuration %j resolves to %d ms', (configured, expected) => {
    expect(resolveInactivityMs(configured)).toBe(expected);
  });
});

describe('the offer', () => {
  it('is shown and handed over once', async () => {
    const hook = setup();

    await wait(12_000);

    expect(hook.result.current.offer).toEqual(offer('account_number.1'));
    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(onOffer).toHaveBeenCalledWith(offer('account_number.1'));
  });

  it('is never asked for twice in one quiet spell', async () => {
    setup();

    await wait(12_000);
    await wait(120_000);

    expect(requestAssistance).toHaveBeenCalledTimes(1);
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it('reading the offer aloud does not start another spell: no offer loop', async () => {
    const hook = setup();
    await wait(12_000);
    expect(onOffer).toHaveBeenCalledTimes(1);

    // The offer is spoken: speaking, then quiet again.
    hook.rerender(base({ voiceActivity: 'speaking' }));
    await wait(4_000);
    hook.rerender(base({ voiceActivity: 'idle' }));
    await wait(120_000);

    expect(requestAssistance).toHaveBeenCalledTimes(1);
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it('a "no offer" answer is not retried', async () => {
    requestAssistance.mockResolvedValue({
      offered: false,
      reason: 'pending_question',
      field: null,
      promptId: null,
      text: null,
    });
    const hook = setup();

    await wait(12_000);
    await wait(60_000);

    expect(requestAssistance).toHaveBeenCalledTimes(1);
    expect(hook.result.current.offer).toBeNull();
    expect(onOffer).not.toHaveBeenCalled();
  });

  it('a failed request (busy, offline) is not retried and shows nothing', async () => {
    requestAssistance.mockRejectedValue(new Error('409'));
    const hook = setup();

    await wait(12_000);
    await wait(60_000);

    expect(requestAssistance).toHaveBeenCalledTimes(1);
    expect(hook.result.current.offer).toBeNull();
  });

  it('after the customer does something, the next offer avoids the last wording', async () => {
    const hook = setup();
    await wait(12_000);

    requestAssistance.mockResolvedValue(offer('account_number.2'));
    act(() => hook.result.current.noteActivity());
    await wait(12_000);

    expect(requestAssistance).toHaveBeenCalledTimes(2);
    expect(requestAssistance.mock.calls[1][1]).toBe('account_number.1');
    expect(hook.result.current.offer?.promptId).toBe('account_number.2');
  });

  it('can be dismissed', async () => {
    const hook = setup();
    await wait(12_000);

    act(() => hook.result.current.dismiss());

    expect(hook.result.current.offer).toBeNull();
  });
});

describe('never while the customer or the assistant is busy', () => {
  it.each([
    ['a request is being sent', { isSending: true }],
    ['the customer is speaking', { voiceActivity: 'listening' as const }],
    ['the utterance is being processed', { voiceActivity: 'processing' as const }],
    ['a reply is being read aloud', { voiceActivity: 'speaking' as const }],
    ['the microphone is starting', { micStatus: 'starting' as const }],
    ['the microphone is recording', { micStatus: 'recording' as const }],
  ])('%s', async (_label, busy) => {
    setup(busy);

    await wait(120_000);

    expect(requestAssistance).not.toHaveBeenCalled();
  });

  it('measures quiet from the moment the assistant stopped speaking', async () => {
    const hook = setup({ voiceActivity: 'speaking' });

    await wait(30_000);
    hook.rerender(base({ voiceActivity: 'idle' }));

    await wait(11_999);
    expect(requestAssistance).not.toHaveBeenCalled();
    await wait(1);
    expect(requestAssistance).toHaveBeenCalledTimes(1);
  });

  it('drops an answer that arrives after the customer started speaking', async () => {
    let resolve!: (value: AssistanceOffer) => void;
    requestAssistance.mockReturnValue(new Promise<AssistanceOffer>((r) => (resolve = r)));
    const hook = setup();

    await wait(12_000);
    const signal = requestAssistance.mock.calls[0][2] as AbortSignal;

    hook.rerender(base({ voiceActivity: 'listening' }));
    expect(signal.aborted).toBe(true);

    await act(async () => resolve(offer('account_number.1')));

    expect(hook.result.current.offer).toBeNull();
    expect(onOffer).not.toHaveBeenCalled();
  });
});

describe('only on a step in progress', () => {
  it.each<[string, Partial<ProactiveAssistanceOptions>]>([
    ['no workflow', { workflow: null }],
    ['no workflow state', { workflow: { name: null, state: 'none', step: null, totalSteps: null } }],
    ['a paused workflow', { workflow: { ...ACCOUNT_STEP, state: 'suspended' } }],
    ['a completed workflow', { workflow: { ...ACCOUNT_STEP, state: 'completed' } }],
    ['a cancelled workflow', { workflow: { ...ACCOUNT_STEP, state: 'cancelled' } }],
    ['an active workflow without a step', { workflow: { ...ACCOUNT_STEP, step: null } }],
    ['an ended visit', { ended: true }],
    ['no visit', { sessionId: null }],
    ['a client that cannot offer', { client: {} }],
  ])('%s: never asks', async (_label, overrides) => {
    setup(overrides);

    await wait(120_000);

    expect(requestAssistance).not.toHaveBeenCalled();
  });
});

describe('resets', () => {
  it('typing or pressing a control restarts the quiet spell', async () => {
    const hook = setup();

    await wait(10_000);
    act(() => hook.result.current.noteActivity());
    await wait(11_999);
    expect(requestAssistance).not.toHaveBeenCalled();

    await wait(1);
    expect(requestAssistance).toHaveBeenCalledTimes(1);
  });

  it('a new turn restarts the spell and clears an old offer', async () => {
    const hook = setup();
    await wait(12_000);
    expect(hook.result.current.offer).not.toBeNull();

    hook.rerender(base({ turnKey: 4 }));
    expect(hook.result.current.offer).toBeNull();

    await wait(12_000);
    expect(requestAssistance).toHaveBeenCalledTimes(2);
  });

  it('the workflow moving to another step restarts the spell and clears the offer', async () => {
    const hook = setup();
    await wait(12_000);

    hook.rerender(base({ workflow: { ...ACCOUNT_STEP, step: 3 } }));
    expect(hook.result.current.offer).toBeNull();

    await wait(11_000);
    hook.rerender(base({ workflow: { ...ACCOUNT_STEP, step: 3 }, turnKey: 2 }));
    await wait(1_000);
    expect(requestAssistance).toHaveBeenCalledTimes(2);
  });

  it('a different visit forgets the last wording', async () => {
    const hook = setup();
    await wait(12_000);

    hook.rerender(base({ sessionId: 'sess-2', turnKey: 0 }));
    await wait(12_000);

    expect(requestAssistance.mock.calls[1][0]).toBe('sess-2');
    expect(requestAssistance.mock.calls[1][1]).toBeNull();
  });
});

describe('cancellation', () => {
  it('unmounting cancels the timer: nothing is asked afterwards', async () => {
    const hook = setup();

    await wait(6_000);
    hook.unmount();
    await wait(60_000);

    expect(requestAssistance).not.toHaveBeenCalled();
  });

  it('unmounting aborts a request in flight, and its answer is ignored', async () => {
    let resolve!: (value: AssistanceOffer) => void;
    requestAssistance.mockReturnValue(new Promise<AssistanceOffer>((r) => (resolve = r)));
    const hook = setup();

    await wait(12_000);
    const signal = requestAssistance.mock.calls[0][2] as AbortSignal;
    hook.unmount();

    expect(signal.aborted).toBe(true);
    await act(async () => resolve(offer('account_number.1')));
    expect(onOffer).not.toHaveBeenCalled();
  });

  it('the visit ending cancels a pending timer', async () => {
    const hook = setup();

    await wait(6_000);
    hook.rerender(base({ ended: true }));
    await wait(60_000);

    expect(requestAssistance).not.toHaveBeenCalled();
  });
});

describe('silence never acts', () => {
  it('the controller only ever asks for an offer: it has no way to send a turn', async () => {
    const hook = setup();

    await wait(12_000);
    await wait(600_000);

    // The whole surface: an offer to show, and two ways to reset it.
    expect(Object.keys(hook.result.current).sort()).toEqual(['dismiss', 'noteActivity', 'offer']);
    expect(requestAssistance).toHaveBeenCalledTimes(1);
  });
});

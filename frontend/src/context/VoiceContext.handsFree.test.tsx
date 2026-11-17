import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationContext,
  type ConversationState,
  type ReplyListener,
} from './ConversationContext';
import { SessionContext, type SessionContextValue } from './SessionContext';
import { RELISTEN_DELAY_MS, VoiceProvider } from './VoiceContext';
import { useVoice } from './useVoice';
import { fakeMicrophoneControls as mic } from '@/test/fakeMicrophone';

/**
 * Hands-free listening: the microphone reopens after a reply -- and only
 * when it safely can.
 *
 * Real: VoiceProvider and useSpeechPlayback. Stand-ins: the microphone
 * (the fake honours useMicrophone's contract, and can end a recording the
 * way end-of-speech detection does), the assistant client, the
 * conversation, and the browser's audio element, whose "ended" / "error"
 * events and play() refusals are fired by hand. Real timers: the reopen
 * delay is awaited, not skipped.
 *
 * None of this exercises a real microphone, real speakers or real TTS.
 */

vi.mock('@/hooks/useMicrophone', async () => ({
  useMicrophone: (await import('@/test/fakeMicrophone')).fakeUseMicrophone,
}));

const speak = vi.fn();

vi.mock('@/services/assistant', () => ({
  assistantClient: {
    sendMessage: vi.fn(),
    speak: (...args: unknown[]) => speak(...args),
  },
}));

const send = vi.fn();
const sendVoice = vi.fn();
const replyListeners = new Set<ReplyListener>();

/** Mutable so a test can end the visit, then re-render. */
let visit = { ended: false, isSending: false };

function conversation(): ConversationState {
  return {
    messages: [],
    isSending: visit.isSending,
    error: null,
    isEmpty: true,
    canRetry: false,
    workflow: null,
    ended: visit.ended,
    send: (...args) => send(...args),
    sendVoice: (...args) => sendVoice(...args),
    retry: async () => {},
    subscribeToReplies: (listener) => {
      replyListeners.add(listener);
      return () => {
        replyListeners.delete(listener);
      };
    },
  };
}

const SESSION = {
  id: 'sess-1',
  status: 'ACTIVE' as const,
  language: 'en',
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
      <ConversationContext.Provider value={conversation()}>
        <VoiceProvider>{children}</VoiceProvider>
      </ConversationContext.Provider>
    </SessionContext.Provider>
  );
}

// --- the browser's audio element ------------------------------------------

/** Every element play() was called on, in order (one reused element). */
let played: HTMLMediaElement[] = [];
let playBehaviour: 'resolve' | 'reject' = 'resolve';

const REPLY = 'Please take a withdrawal slip.';
const audioReply = () => new Blob([new Uint8Array(512)], { type: 'audio/mpeg' });

/** The browser reports the current reply has played to its end. */
function playbackEnds(): void {
  const element = played.at(-1)!;
  act(() => {
    element.onended?.call(element, new Event('ended'));
  });
}

/**
 * The reply has ended and a reopen is now SCHEDULED but has not fired:
 * the turn has settled back to idle, within the settle delay.
 */
async function reopenPending(hook: { result: { current: { activity: string } } }) {
  playbackEnds();
  await waitFor(() => expect(hook.result.current.activity).toBe('idle'), {
    timeout: RELISTEN_DELAY_MS - 100,
    interval: 10,
  });
  expect(mic.attempts).toBe(1);
}

/** Longer than the reopen delay: enough for any reopen to have happened. */
const pastReopen = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, RELISTEN_DELAY_MS + 150)));

beforeEach(() => {
  sessionStorage.clear();
  mic.reset();
  replyListeners.clear();
  visit = { ended: false, isSending: false };
  played = [];
  playBehaviour = 'resolve';

  send.mockReset().mockResolvedValue(undefined);
  sendVoice.mockReset().mockResolvedValue(REPLY);
  speak.mockReset().mockImplementation(async () => audioReply());

  let counter = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:fake/${++counter}`),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    // The silent unlock clip is not a reply.
    if (this.getAttribute('src')?.startsWith('blob:')) played.push(this);
    return playBehaviour === 'resolve'
      ? Promise.resolve()
      : Promise.reject(new DOMException('refused', 'NotAllowedError'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderVoice() {
  const hook = renderHook(() => useVoice(), { wrapper });
  act(() => hook.result.current.enable());
  return hook;
}

/** Starts hands-free with a press, and waits for the microphone. */
function press(hook: ReturnType<typeof renderVoice>) {
  act(() => hook.result.current.startListening());
  expect(hook.result.current.activity).toBe('listening');
}

/** The customer finishes speaking; the reply is fetched and starts playing. */
async function utteranceEndsAndReplyPlays(hook: ReturnType<typeof renderVoice>, nth = 1) {
  act(() => mic.endpoint!('speech_ended'));
  await waitFor(() => expect(speak).toHaveBeenCalledTimes(nth));
  await waitFor(() => expect(hook.result.current.activity).toBe('speaking'));
  await waitFor(() => expect(played).toHaveLength(nth));
}

describe('hands-free listening', () => {
  it('opens the microphone only after an explicit press', async () => {
    const hook = renderVoice();

    // Enabling voice is consent to the control, not to being recorded.
    await pastReopen();
    expect(mic.attempts).toBe(0);
    expect(hook.result.current.activity).toBe('idle');

    press(hook);
    expect(mic.starts).toBe(1);
  });

  it('sends an utterance that ends by itself exactly once', async () => {
    const hook = renderVoice();
    press(hook);

    act(() => mic.endpoint!('speech_ended'));
    act(() => mic.endpoint!('speech_ended')); // a late duplicate end

    await waitFor(() => expect(sendVoice).toHaveBeenCalledTimes(1));
    await pastReopen();
    expect(sendVoice).toHaveBeenCalledTimes(1);
  });

  it('does not reopen the microphone while the request is pending', async () => {
    let settle!: (reply: string) => void;
    sendVoice.mockReturnValue(new Promise<string>((resolve) => (settle = resolve)));
    const hook = renderVoice();
    press(hook);

    act(() => mic.endpoint!('speech_ended'));
    await waitFor(() => expect(hook.result.current.activity).toBe('processing'));

    await pastReopen();
    await pastReopen();
    expect(mic.attempts).toBe(1);

    await act(async () => settle(REPLY));
    await waitFor(() => expect(played).toHaveLength(1));
    playbackEnds();
    await waitFor(() => expect(mic.starts).toBe(2));
  });

  it('reopens exactly once, and only after playback has actually ended', async () => {
    const hook = renderVoice();
    press(hook);
    await utteranceEndsAndReplyPlays(hook);

    // Still speaking: the assistant's voice must never be recorded.
    await pastReopen();
    expect(mic.attempts).toBe(1);

    playbackEnds();
    expect(mic.attempts).toBe(1); // not before the settle delay

    await waitFor(() => expect(mic.starts).toBe(2));
    // The counter moves inside the timer; the state follows on the next render.
    await waitFor(() => expect(hook.result.current.activity).toBe('listening'));

    // A repeated "ended" event, and time passing, add nothing.
    const element = played[0];
    act(() => {
      element.onended?.call(element, new Event('ended'));
    });
    await pastReopen();
    expect(mic.attempts).toBe(2);
  });

  it('carries on for turn after turn', async () => {
    const hook = renderVoice();
    press(hook);

    await utteranceEndsAndReplyPlays(hook, 1);
    playbackEnds();
    await waitFor(() => expect(mic.starts).toBe(2));

    await utteranceEndsAndReplyPlays(hook, 2);
    playbackEnds();
    await waitFor(() => expect(mic.starts).toBe(3));

    expect(sendVoice).toHaveBeenCalledTimes(2);
  });

  describe('when a reply cannot be heard', () => {
    it('stops hands-free with a visible message when playback fails, and does not retry', async () => {
      playBehaviour = 'reject';
      const hook = renderVoice();
      press(hook);

      act(() => mic.endpoint!('speech_ended'));

      await waitFor(() => expect(hook.result.current.speechError).toMatch(/could not be played/i));
      await waitFor(() => expect(hook.result.current.activity).toBe('idle'));

      await pastReopen();
      await pastReopen();
      expect(mic.attempts).toBe(1);
      expect(speak).toHaveBeenCalledTimes(1);
      expect(sendVoice).toHaveBeenCalledTimes(1);
    });

    it('stops hands-free safely when speech is unavailable (the TTS provider refuses)', async () => {
      speak.mockRejectedValue(new Error('Speech service returned 422'));
      const hook = renderVoice();
      press(hook);

      act(() => mic.endpoint!('speech_ended'));

      await waitFor(() => expect(hook.result.current.speechError).toMatch(/unavailable/i));
      await waitFor(() => expect(hook.result.current.activity).toBe('idle'));

      await pastReopen();
      await pastReopen();
      expect(mic.attempts).toBe(1);
      // Voice stays on and usable: the next press starts again.
      expect(hook.result.current.isEnabled).toBe(true);
      press(hook);
      expect(mic.starts).toBe(2);
    });

    it('stops hands-free when the turn produced no reply', async () => {
      sendVoice.mockResolvedValue(null);
      const hook = renderVoice();
      press(hook);

      act(() => mic.endpoint!('speech_ended'));
      await waitFor(() => expect(hook.result.current.activity).toBe('idle'));

      await pastReopen();
      expect(mic.attempts).toBe(1);
      expect(speak).not.toHaveBeenCalled();
    });
  });

  describe('the customer stays in control', () => {
    it('a tap while the reply is being fetched stops everything', async () => {
      let settle!: (reply: string) => void;
      sendVoice.mockReturnValue(new Promise<string>((resolve) => (settle = resolve)));
      const hook = renderVoice();
      press(hook);
      act(() => mic.endpoint!('speech_ended'));
      await waitFor(() => expect(hook.result.current.activity).toBe('processing'));

      act(() => hook.result.current.reset());
      await act(async () => settle(REPLY));

      await pastReopen();
      expect(speak).not.toHaveBeenCalled();
      expect(mic.attempts).toBe(1);
    });

    it('a tap while the reply is playing stops it and does not reopen', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      act(() => hook.result.current.reset());

      // Even a late "ended" from the stopped clip changes nothing.
      const element = played[0];
      act(() => {
        element.onended?.call(element, new Event('ended'));
      });
      await pastReopen();
      expect(mic.attempts).toBe(1);
      expect(hook.result.current.activity).toBe('idle');
    });

    it('stopping speech does not reopen the microphone', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      act(() => hook.result.current.stopSpeaking());

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });

    it('a tap in the gap between the reply ending and the reopen wins', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      await reopenPending(hook);
      act(() => hook.result.current.reset()); // within the settle delay

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });

    it('turning voice off in that gap wins too', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      await reopenPending(hook);
      act(() => hook.result.current.disable());

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });

    it('turning voice off during playback ends the session for good', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      act(() => hook.result.current.disable());

      await pastReopen();
      expect(mic.attempts).toBe(1);
      expect(hook.result.current.isEnabled).toBe(false);
    });

    it('a deliberate "stop listening" still sends, but does not carry on by itself', async () => {
      const hook = renderVoice();
      press(hook);

      act(() => hook.result.current.stopListening());
      await waitFor(() => expect(played).toHaveLength(1));
      playbackEnds();

      await pastReopen();
      expect(sendVoice).toHaveBeenCalledTimes(1);
      expect(mic.attempts).toBe(1);
    });
  });

  describe('ending by itself', () => {
    it('silence ends the session: nothing is sent and nothing reopens', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);
      playbackEnds();
      await waitFor(() => expect(mic.starts).toBe(2));

      act(() => mic.endpoint!('no_speech'));

      await pastReopen();
      expect(hook.result.current.activity).toBe('idle');
      expect(mic.attempts).toBe(2);
      expect(sendVoice).toHaveBeenCalledTimes(1);
    });

    it('a microphone that fails to reopen is not retried in a loop', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      mic.failWith = { status: 'error', message: 'The microphone could not be started.' };
      playbackEnds();

      await waitFor(() => expect(mic.attempts).toBe(2));
      await pastReopen();
      await pastReopen();
      expect(mic.attempts).toBe(2);
      expect(hook.result.current.micStatus).toBe('error');
    });

    it('stops listening once the visit has ended', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      // The customer said goodbye; the engine ended the visit.
      visit = { ...visit, ended: true };
      hook.rerender();
      playbackEnds();

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });

    it('stops listening if the visit ends while a reopen is scheduled', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      await reopenPending(hook);
      visit = { ...visit, ended: true };
      hook.rerender();

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });

    it('does not reopen into a request that is already pending', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      await reopenPending(hook);
      // e.g. a typed message sent in the gap.
      visit = { ...visit, isSending: true };
      hook.rerender();

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });
  });

  describe('unmounting', () => {
    it('during playback: nothing reopens afterwards', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      hook.unmount();

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });

    it('with a reopen already scheduled: it never fires', async () => {
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);

      await reopenPending(hook);
      hook.unmount();

      await pastReopen();
      expect(mic.attempts).toBe(1);
    });
  });

  it('typed messages never start hands-free listening', async () => {
    const hook = renderVoice();

    act(() => {
      for (const listener of replyListeners) listener({ text: REPLY, input: 'text', workflow: null });
    });
    await waitFor(() => expect(played).toHaveLength(1));
    playbackEnds();

    await pastReopen();
    expect(mic.attempts).toBe(0);
    expect(hook.result.current.activity).toBe('idle');
  });

  describe('resuming after the assistant speaks outside a voice turn', () => {
    const OFFER = 'Do you need any help?';

    /** Hands-free running, one turn done, then the customer stays quiet. */
    async function pausedBySilence(hook: ReturnType<typeof renderVoice>) {
      press(hook);
      await utteranceEndsAndReplyPlays(hook);
      playbackEnds();
      await waitFor(() => expect(mic.starts).toBe(2));
      act(() => mic.endpoint!('no_speech'));
      await pastReopen();
      // Silence alone reopens nothing.
      expect(mic.attempts).toBe(2);
      expect(hook.result.current.activity).toBe('idle');
    }

    /** The proactive offer of help is read out (AssistantPage -> speak()). */
    async function offerPlays(hook: ReturnType<typeof renderVoice>, nth: number) {
      act(() => {
        void hook.result.current.speak(OFFER);
      });
      await waitFor(() => expect(played).toHaveLength(nth));
      await waitFor(() => expect(hook.result.current.activity).toBe('speaking'));
    }

    it('reopens after an offer of help has finished, and the next turn goes through', async () => {
      const hook = renderVoice();
      await pausedBySilence(hook);

      await offerPlays(hook, 2);
      // Not while the offer is still playing.
      await pastReopen();
      expect(mic.attempts).toBe(2);

      playbackEnds();
      await waitFor(() => expect(mic.starts).toBe(3));
      await waitFor(() => expect(hook.result.current.activity).toBe('listening'));

      // The customer answers, and the conversation carries on by itself.
      // (The third thing spoken: reply, offer, reply.)
      await utteranceEndsAndReplyPlays(hook, 3);
      expect(sendVoice).toHaveBeenCalledTimes(2);
      playbackEnds();
      await waitFor(() => expect(mic.starts).toBe(4));
    });

    it('reopens with an automatic start, once', async () => {
      const hook = renderVoice();
      await pausedBySilence(hook);
      await offerPlays(hook, 2);
      playbackEnds();
      await waitFor(() => expect(mic.starts).toBe(3));

      await pastReopen();
      expect(mic.attempts).toBe(3);
      // The press was the only start with a tap behind it.
      expect(mic.automaticStarts).toBe(2);
    });

    it('does not resume when voice is turned off while the offer plays', async () => {
      const hook = renderVoice();
      await pausedBySilence(hook);
      await offerPlays(hook, 2);

      act(() => hook.result.current.disable());
      playbackEnds();
      await pastReopen();

      expect(mic.attempts).toBe(2);
      expect(hook.result.current.activity).toBe('idle');
    });

    it('does not resume after the customer stopped hands-free themselves', async () => {
      const hook = renderVoice();
      press(hook);
      act(() => hook.result.current.stopListening());
      await waitFor(() => expect(played).toHaveLength(1));
      playbackEnds();
      await pastReopen();

      await offerPlays(hook, 2);
      playbackEnds();
      await pastReopen();

      expect(mic.attempts).toBe(1);
      expect(sendVoice).toHaveBeenCalledTimes(1);
    });

    it('does not resume after cancelling', async () => {
      const hook = renderVoice();
      press(hook);
      act(() => hook.result.current.reset());

      await offerPlays(hook, 1);
      playbackEnds();
      await pastReopen();

      expect(mic.attempts).toBe(1);
      expect(sendVoice).not.toHaveBeenCalled();
    });

    it('never opens the microphone for an offer outside a hands-free session', async () => {
      const hook = renderVoice();

      await offerPlays(hook, 1);
      playbackEnds();
      await pastReopen();

      expect(mic.attempts).toBe(0);
    });

    it('does not resume when the offer could not be played', async () => {
      const hook = renderVoice();
      await pausedBySilence(hook);

      // The browser refuses to play it. The written offer is on screen; a
      // line spoken outside a turn fails quietly.
      playBehaviour = 'reject';
      act(() => {
        void hook.result.current.speak(OFFER);
      });
      await waitFor(() => expect(played).toHaveLength(2));
      await pastReopen();

      expect(mic.attempts).toBe(2);
      expect(hook.result.current.activity).toBe('idle');
    });
  });

  describe('a browser that measures audio only inside a tap (Safari)', () => {
    it('does not reopen by itself; it asks for a tap, and a tap works', async () => {
      mic.automaticUnmeasurable = true;
      const hook = renderVoice();
      press(hook);
      await utteranceEndsAndReplyPlays(hook);
      playbackEnds();
      await waitFor(() => expect(mic.automaticStarts).toBe(1));
      await pastReopen();

      // The automatic reopen was tried, opened nothing, and said why.
      expect(mic.starts).toBe(1);
      expect(hook.result.current.activity).toBe('idle');
      expect(hook.result.current.speechError).toMatch(/tap the microphone/i);

      // The session is over: a later spoken line does not retry in a loop.
      act(() => {
        void hook.result.current.speak('Do you need any help?');
      });
      await waitFor(() => expect(played).toHaveLength(2));
      playbackEnds();
      await pastReopen();
      expect(mic.attempts).toBe(2);

      // A tap is a gesture, and opens the microphone normally.
      press(hook);
      expect(mic.starts).toBe(2);
    });
  });
});

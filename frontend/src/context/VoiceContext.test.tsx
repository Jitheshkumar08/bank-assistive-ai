import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationContext,
  type ConversationState,
  type ReplyListener,
} from './ConversationContext';
import { SessionContext, type SessionContextValue } from './SessionContext';
import { VoiceProvider } from './VoiceContext';
import { useVoice } from './useVoice';
import { voicePreferenceStorage } from '@/lib/voicePreference';
import { fakeMicrophoneControls } from '@/test/fakeMicrophone';

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

/** Whoever subscribed to the fake conversation's replies. */
const replyListeners = new Set<ReplyListener>();

/** Plays the part of the conversation delivering a reply. */
function deliverReply(text: string, input: 'text' | 'voice' = 'text'): void {
  for (const listener of replyListeners) listener({ text, input, workflow: null });
}

function conversation(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    messages: [],
    isSending: false,
    error: null,
    isEmpty: true,
    canRetry: false,
    workflow: null,
    ended: false,
    send: (...args) => send(...args),
    sendVoice: (...args) => sendVoice(...args),
    retry: async () => {},
    subscribeToReplies: (listener) => {
      replyListeners.add(listener);
      return () => {
        replyListeners.delete(listener);
      };
    },
    ...overrides,
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

const renderVoice = () => renderHook(() => useVoice(), { wrapper });

describe('VoiceProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    fakeMicrophoneControls.reset();
    replyListeners.clear();
    send.mockReset().mockResolvedValue(undefined);
    sendVoice.mockReset().mockResolvedValue(null);
    speak.mockReset().mockResolvedValue(new Blob([], { type: 'audio/mpeg' }));
  });

  describe('preference', () => {
    it('starts unset so the customer is asked once', () => {
      const { result } = renderVoice();

      expect(result.current.preference).toBe('unset');
      expect(result.current.needsChoice).toBe(true);
      expect(result.current.isEnabled).toBe(false);
    });

    it('records an opt-in', () => {
      const { result } = renderVoice();

      act(() => result.current.enable());

      expect(result.current.preference).toBe('enabled');
      expect(result.current.isEnabled).toBe(true);
      expect(result.current.needsChoice).toBe(false);
    });

    it('records a decline, and stops asking', () => {
      const { result } = renderVoice();

      act(() => result.current.disable());

      expect(result.current.preference).toBe('disabled');
      expect(result.current.needsChoice).toBe(false);
    });

    it('persists the choice for the browser session', () => {
      const { result, unmount } = renderVoice();
      act(() => result.current.enable());
      unmount();

      // A fresh provider, as after navigating or reloading the page.
      const { result: reopened } = renderVoice();

      expect(reopened.current.preference).toBe('enabled');
      expect(reopened.current.needsChoice).toBe(false);
    });

    it('survives unreadable storage rather than crashing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });

      // Private browsing and hardened settings throw here. Falling back
      // to "ask again" is the safe answer.
      expect(voicePreferenceStorage.read()).toBe('unset');
      vi.restoreAllMocks();
    });
  });

  describe('enabling does not start recording', () => {
    it('leaves voice idle when enabled', () => {
      const { result } = renderVoice();

      act(() => result.current.enable());

      // The whole point: available is not the same as recording.
      expect(result.current.activity).toBe('idle');
      expect(result.current.isBusy).toBe(false);
    });

    it('refuses to start a turn while voice is disabled', () => {
      const { result } = renderVoice();
      act(() => result.current.disable());

      act(() => result.current.startListening());

      expect(result.current.activity).toBe('idle');
    });

    it('refuses to start a turn before the customer has chosen', () => {
      const { result } = renderVoice();

      act(() => result.current.startListening());

      expect(result.current.activity).toBe('idle');
    });
  });

  describe('activity state machine', () => {
    it('moves to listening only when the customer starts it', () => {
      const { result } = renderVoice();
      act(() => result.current.enable());

      act(() => result.current.startListening());

      expect(result.current.activity).toBe('listening');
      expect(result.current.isBusy).toBe(true);
    });

    it('runs listening to processing and back to idle around a send', async () => {
      let settle!: () => void;
      send.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.submitUtterance('I want to deposit money');
      });

      expect(result.current.activity).toBe('processing');

      await act(async () => {
        settle();
        await pending;
      });

      expect(result.current.activity).toBe('idle');
    });

    it('sends the utterance through the one conversation', async () => {
      const { result } = renderVoice();
      act(() => result.current.enable());

      await act(() => result.current.submitUtterance('  I want to withdraw money  '));

      // The same send() a typed message uses; there is no voice pipeline.
      expect(send).toHaveBeenCalledWith('I want to withdraw money');
    });

    it('ignores an utterance that turned out to be silence', async () => {
      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());

      await act(() => result.current.submitUtterance('   '));

      expect(send).not.toHaveBeenCalled();
      expect(result.current.activity).toBe('idle');
    });

    it('supports the speaking state that TTS will drive', () => {
      const { result } = renderVoice();
      act(() => result.current.enable());

      act(() => result.current.startSpeaking());
      expect(result.current.activity).toBe('speaking');

      act(() => result.current.stopSpeaking());
      expect(result.current.activity).toBe('idle');
    });

    it('returns to idle even when the send fails', async () => {
      send.mockRejectedValue(new Error('network'));

      const { result } = renderVoice();
      act(() => result.current.enable());

      await act(async () => {
        await result.current.submitUtterance('hello').catch(() => {});
      });

      expect(result.current.activity).toBe('idle');
    });
  });

  describe('a completed recording reaches the conversation', () => {
    it('runs listening to processing and back to idle', async () => {
      let settle!: () => void;
      sendVoice.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      expect(result.current.activity).toBe('listening');

      act(() => result.current.stopListening());

      // The recording is handed to the conversation, not to a separate
      // voice pipeline.
      await waitFor(() => expect(result.current.activity).toBe('processing'));
      expect(sendVoice).toHaveBeenCalledTimes(1);
      expect(sendVoice.mock.calls[0][1]).toMatch(/^audio\//);

      await act(async () => {
        settle();
      });

      await waitFor(() => expect(result.current.activity).toBe('idle'));
    });

    it('records the size and format without keeping the audio', async () => {
      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());

      await waitFor(() => expect(result.current.lastRecording).not.toBeNull());
      expect(result.current.lastRecording).toEqual({
        sizeBytes: 2048,
        mimeType: 'audio/webm',
      });
    });

    it('does not resurrect a voice turn abandoned mid-flight', async () => {
      let settle!: () => void;
      sendVoice.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());
      await waitFor(() => expect(result.current.activity).toBe('processing'));

      act(() => result.current.disable());
      expect(result.current.activity).toBe('idle');

      await act(async () => {
        settle();
      });

      // The reply landing after the customer switched voice off must not
      // pull the UI back out of rest.
      await waitFor(() => expect(result.current.activity).toBe('idle'));
      expect(result.current.isEnabled).toBe(false);
    });

    it('cancelling a recording sends nothing', async () => {
      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());

      act(() => result.current.reset());

      expect(sendVoice).not.toHaveBeenCalled();
      expect(result.current.activity).toBe('idle');
    });
  });

  describe('speaking the reply', () => {
    it('speaks after a voice turn, then returns to idle', async () => {
      sendVoice.mockResolvedValue('Please take a withdrawal slip.');

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());

      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
      // Only the visit and the text: the voice is the server's decision.
      expect(speak.mock.calls[0][0]).toEqual({
        sessionId: 'sess-1',
        text: 'Please take a withdrawal slip.',
      });

      await waitFor(() => expect(result.current.activity).toBe('idle'));
    });

    it('does not speak when the turn produced no reply', async () => {
      sendVoice.mockResolvedValue(null);

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());

      await waitFor(() => expect(result.current.activity).toBe('idle'));
      expect(speak).not.toHaveBeenCalled();
    });

    it('keeps the conversation when speech fails', async () => {
      sendVoice.mockResolvedValue('Please take a withdrawal slip.');
      speak.mockRejectedValue(new Error('tts down'));

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());

      // A silent reply, not a lost one: the written answer is untouched
      // and voice returns to a usable state.
      await waitFor(() => expect(result.current.speechError).toMatch(/unavailable/i));
      await waitFor(() => expect(result.current.activity).toBe('idle'));
      expect(result.current.isEnabled).toBe(true);
    });

    it('does not speak a reply the customer abandoned', async () => {
      let settle!: (reply: string) => void;
      sendVoice.mockReturnValue(new Promise<string>((resolve) => (settle = resolve)));

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());
      await waitFor(() => expect(result.current.activity).toBe('processing'));

      act(() => result.current.disable());

      await act(async () => {
        settle('Please take a withdrawal slip.');
      });

      // Switching voice off mid-thought must not produce speech after
      // the fact.
      await waitFor(() => expect(result.current.activity).toBe('idle'));
      expect(speak).not.toHaveBeenCalled();
    });

    it('stopSpeaking returns to rest', () => {
      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startSpeaking());
      expect(result.current.activity).toBe('speaking');

      act(() => result.current.stopSpeaking());

      expect(result.current.activity).toBe('idle');
    });
  });

  describe('speaking typed replies', () => {
    it('reads a typed reply aloud while voice is on', async () => {
      const { result } = renderVoice();
      act(() => result.current.enable());

      act(() => deliverReply('Please take a deposit slip.'));

      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
      // Typed, a suggestion, or a retry: all arrive as text, and all are
      // read out exactly the way a spoken question's answer is.
      expect(speak.mock.calls[0][0]).toEqual({
        sessionId: 'sess-1',
        text: 'Please take a deposit slip.',
      });
      await waitFor(() => expect(result.current.activity).toBe('idle'));
    });

    it('stays silent while voice is off', async () => {
      const { result } = renderVoice();
      act(() => result.current.disable());

      act(() => deliverReply('Please take a deposit slip.'));

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(speak).not.toHaveBeenCalled();
    });

    it('stays silent before the customer has chosen', async () => {
      renderVoice();

      act(() => deliverReply('Please take a deposit slip.'));

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(speak).not.toHaveBeenCalled();
    });

    it('reads a spoken reply exactly once', async () => {
      // The real conversation announces every reply, spoken ones
      // included, and a voice turn also reads its own reply. Only one of
      // them may speak.
      sendVoice.mockImplementation(async () => {
        deliverReply('Please take a withdrawal slip.', 'voice');
        return 'Please take a withdrawal slip.';
      });

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());

      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(speak).toHaveBeenCalledTimes(1);
    });

    it('does not read out a spoken reply the customer pressed past', async () => {
      // As the real conversation does: the reply is announced to every
      // listener, spoken turns included, just before the turn resolves.
      let settle!: () => void;
      sendVoice.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            settle = () => {
              deliverReply('Please take a withdrawal slip.', 'voice');
              resolve('Please take a withdrawal slip.');
            };
          }),
      );

      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());
      await waitFor(() => expect(result.current.activity).toBe('processing'));

      // Pressing the control mid-thought. Voice stays on -- only this
      // answer is no longer wanted.
      act(() => result.current.reset());

      await act(async () => {
        settle();
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(speak).not.toHaveBeenCalled();
      expect(result.current.isEnabled).toBe(true);
    });

    it('never talks over a customer who is recording', async () => {
      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());
      await waitFor(() => expect(result.current.activity).toBe('listening'));

      act(() => deliverReply('Please take a deposit slip.'));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Playing now would be picked up by the microphone and sent back as
      // the customer's own words -- and the control would stop showing
      // that it is still recording.
      expect(result.current.activity).toBe('listening');
    });

    it('drops a reply still being fetched once the customer starts recording', async () => {
      let settle!: (audio: Blob) => void;
      speak.mockReturnValue(new Promise<Blob>((resolve) => (settle = resolve)));

      const { result } = renderVoice();
      act(() => result.current.enable());

      act(() => deliverReply('Please take a deposit slip.'));
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

      act(() => result.current.startListening());
      await waitFor(() => expect(result.current.activity).toBe('listening'));

      await act(async () => {
        settle(new Blob([], { type: 'audio/mpeg' }));
      });

      expect(result.current.activity).toBe('listening');
    });
  });

  describe('permission to play sound', () => {
    it('is bought from the first tap after a remembered opt-in', () => {
      const played: Array<string | null> = [];
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(function (this: HTMLMediaElement) {
          played.push(this.getAttribute('src'));
          return Promise.resolve();
        });

      try {
        // Chosen earlier in the visit, then the page reloaded: there will
        // be no opt-in tap and no microphone tap before the first typed
        // question, so any tap has to count.
        voicePreferenceStorage.write('enabled');
        renderVoice();

        act(() => document.body.click());

        expect(played).toHaveLength(1);
        expect(played[0]).toMatch(/^data:audio\/wav/);

        // Once is enough; later taps must not keep re-priming.
        act(() => document.body.click());
        expect(played).toHaveLength(1);
      } finally {
        playSpy.mockRestore();
      }
    });

    it('keeps the silent clip it plays when voice is switched on', () => {
      const seen: { primed: HTMLMediaElement | null } = { primed: null };
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(function (this: HTMLMediaElement) {
          if ((this.getAttribute('src') ?? '').startsWith('data:audio/wav')) seen.primed = this;
          return Promise.resolve();
        });

      try {
        const { result } = renderVoice();

        act(() => result.current.enable());

        // Switching voice on also resets any turn in progress. Resetting
        // after priming stopped the silent clip mid-play -- a real browser
        // reported it as aborted -- and a strict browser may then treat the
        // element as never having been allowed to play.
        expect(seen.primed).not.toBeNull();
        expect(seen.primed?.getAttribute('src')).toMatch(/^data:audio\/wav/);
      } finally {
        playSpy.mockRestore();
      }
    });

    it('is not sought while voice is off', () => {
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

      try {
        voicePreferenceStorage.write('disabled');
        renderVoice();

        act(() => document.body.click());

        expect(playSpy).not.toHaveBeenCalled();
      } finally {
        playSpy.mockRestore();
      }
    });
  });

  describe('cancellation', () => {
    it.each(['listening', 'speaking'] as const)('resets from %s', (from) => {
      const { result } = renderVoice();
      act(() => result.current.enable());

      act(() => {
        if (from === 'listening') result.current.startListening();
        else result.current.startSpeaking();
      });
      expect(result.current.activity).toBe(from);

      act(() => result.current.reset());

      expect(result.current.activity).toBe('idle');
    });

    it('turning voice off stops whatever was happening', () => {
      const { result } = renderVoice();
      act(() => result.current.enable());
      act(() => result.current.startListening());

      act(() => result.current.disable());

      expect(result.current.activity).toBe('idle');
      expect(result.current.isEnabled).toBe(false);
    });

    it('a reset mid-send is not undone when the reply lands', async () => {
      let settle!: () => void;
      send.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));

      const { result } = renderVoice();
      act(() => result.current.enable());

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.submitUtterance('hello');
      });
      expect(result.current.activity).toBe('processing');

      act(() => result.current.disable());
      expect(result.current.activity).toBe('idle');

      await act(async () => {
        settle();
        await pending;
      });

      // The abandoned turn must not drag the UI back out of rest.
      await waitFor(() => expect(result.current.activity).toBe('idle'));
    });
  });
});

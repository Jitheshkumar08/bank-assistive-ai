import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationContext, type ConversationState } from './ConversationContext';
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

function conversation(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    messages: [],
    isSending: false,
    error: null,
    isEmpty: true,
    canRetry: false,
    send: (...args) => send(...args),
    sendVoice: (...args) => sendVoice(...args),
    retry: async () => {},
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

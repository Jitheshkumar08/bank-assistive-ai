import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseMicrophoneOptions } from '@/hooks/useMicrophone';
import { ConversationContext, type ConversationState } from './ConversationContext';
import { SessionContext, type SessionContextValue } from './SessionContext';
import { VoiceProvider } from './VoiceContext';
import { useVoice } from './useVoice';
import { fakeMicrophoneControls as mic } from '@/test/fakeMicrophone';
import {
  DEFAULT_VOICE_END_SILENCE_MS,
  DEFAULT_VOICE_RELISTEN_DELAY_MS,
  VOICE_ENDPOINTING,
  VOICE_RELISTEN_DELAY_MS,
  resolveEndSilenceMs,
  resolveRelistenDelayMs,
} from '@/lib/voiceTiming';

/**
 * The branch's voice timings: a 3 s gap before hands-free listening resumes
 * after the assistant speaks, and 3 s of silence to end the customer's turn.
 * The provider must actually use what it is given.
 */

const micOptions: UseMicrophoneOptions[] = [];

vi.mock('@/hooks/useMicrophone', async () => {
  const { fakeUseMicrophone } = await import('@/test/fakeMicrophone');
  return {
    useMicrophone: (options: UseMicrophoneOptions) => {
      micOptions.push(options);
      return fakeUseMicrophone(options);
    },
  };
});

const speak = vi.fn();
vi.mock('@/services/assistant', () => ({
  assistantClient: { sendMessage: vi.fn(), speak: (...args: unknown[]) => speak(...args) },
}));

const sendVoice = vi.fn();

const conversation: ConversationState = {
  messages: [],
  isSending: false,
  error: null,
  isEmpty: true,
  canRetry: false,
  workflow: null,
  ended: false,
  send: vi.fn(),
  sendVoice: (...args) => sendVoice(...args),
  retry: async () => {},
  subscribeToReplies: () => () => {},
};

const SESSION = {
  id: 'sess-1',
  status: 'ACTIVE' as const,
  language: 'en',
  startedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  endedAt: null,
  branch: { id: 'b1', code: 'BR001', name: 'Synthetic Branch', city: null },
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

let played: HTMLMediaElement[] = [];

beforeEach(() => {
  sessionStorage.clear();
  mic.reset();
  micOptions.length = 0;
  played = [];
  sendVoice.mockReset().mockResolvedValue('Please take a deposit slip.');
  speak.mockReset().mockImplementation(async () => new Blob([new Uint8Array(64)], { type: 'audio/mpeg' }));
  let counter = 0;
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => `blob:fake/${++counter}`), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    if (this.getAttribute('src')?.startsWith('blob:')) played.push(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(props: { relistenDelayMs?: number; endpointing?: { endSilenceMs: number } }) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionContext.Provider value={session}>
      <ConversationContext.Provider value={conversation}>
        <VoiceProvider {...props}>{children}</VoiceProvider>
      </ConversationContext.Provider>
    </SessionContext.Provider>
  );
  const hook = renderHook(() => useVoice(), { wrapper });
  act(() => hook.result.current.enable());
  return hook;
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe('voice timings', () => {
  it('the branch defaults are a 3 s gap and 3 s of end silence', () => {
    expect(DEFAULT_VOICE_RELISTEN_DELAY_MS).toBe(3_000);
    expect(DEFAULT_VOICE_END_SILENCE_MS).toBe(3_000);
    // No VITE_VOICE_* variables in the test environment: the defaults apply.
    expect(VOICE_RELISTEN_DELAY_MS).toBe(3_000);
    expect(VOICE_ENDPOINTING).toEqual({ endSilenceMs: 3_000 });
  });

  it('a configured value is used only when it is sensible', () => {
    expect(resolveRelistenDelayMs('4000')).toBe(4_000);
    expect(resolveEndSilenceMs(3500)).toBe(3_500);
    for (const bad of ['', 'abc', '50', '999999', null, undefined, Number.NaN]) {
      expect(resolveRelistenDelayMs(bad)).toBe(3_000);
      expect(resolveEndSilenceMs(bad)).toBe(3_000);
    }
  });

  it('the provider hands its end-of-speech settings to the microphone', () => {
    render({ endpointing: { endSilenceMs: 3_000 } });
    expect(micOptions.at(-1)?.endpointing).toEqual({ endSilenceMs: 3_000 });
  });

  it('hands-free listening resumes only after the configured gap', async () => {
    const hook = render({ relistenDelayMs: 1_200 });
    act(() => hook.result.current.startListening());

    act(() => mic.endpoint!('speech_ended'));
    await waitFor(() => expect(played).toHaveLength(1));
    const element = played[0];
    act(() => {
      element.onended?.call(element, new Event('ended'));
    });
    await waitFor(() => expect(hook.result.current.activity).toBe('idle'));

    await wait(700); // well inside the gap: still waiting
    expect(mic.starts).toBe(1);

    await wait(800); // past 1.2 s: reopened by itself, once
    expect(mic.starts).toBe(2);
    expect(mic.automaticStarts).toBe(1);
  });
});

import { vi } from 'vitest';
import type { VoiceContextValue } from '@/context/VoiceContext';

/**
 * A scripted voice context: plain values and spy actions.
 *
 * For presentation tests that need to put the voice session into an exact
 * state -- listening, speaking, a refused microphone -- without a real
 * microphone, speaker or provider. The lifecycle itself is covered by the
 * VoiceContext suites against the real provider.
 */
export function fakeVoice(overrides: Partial<VoiceContextValue> = {}): VoiceContextValue {
  const activity = overrides.activity ?? 'idle';

  return {
    preference: 'enabled',
    isEnabled: true,
    needsChoice: false,
    activity,
    isBusy: activity !== 'idle',
    micStatus: activity === 'listening' ? 'recording' : 'idle',
    micMessage: null,
    retryMicrophone: vi.fn(),
    speechError: null,
    lastRecording: null,
    readMicLevel: () => null,
    enable: vi.fn(),
    disable: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
    submitUtterance: vi.fn(async () => {}),
    startSpeaking: vi.fn(),
    stopSpeaking: vi.fn(),
    speak: vi.fn(async () => {}),
    reset: vi.fn(),
    ...overrides,
  };
}

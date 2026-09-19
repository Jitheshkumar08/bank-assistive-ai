import { useContext } from 'react';
import { VoiceContext, type VoiceContextValue } from './VoiceContext';

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext);

  if (!context) {
    throw new Error('useVoice must be used inside a VoiceProvider.');
  }

  return context;
}

/**
 * The voice controls when a provider is present, or null.
 *
 * For a screen that works with or without voice -- the conversation can
 * be typed in whether or not a VoiceProvider sits above it.
 */
export function useOptionalVoice(): VoiceContextValue | null {
  return useContext(VoiceContext);
}

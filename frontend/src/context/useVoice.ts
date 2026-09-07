import { useContext } from 'react';
import { VoiceContext, type VoiceContextValue } from './VoiceContext';

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext);

  if (!context) {
    throw new Error('useVoice must be used inside a VoiceProvider.');
  }

  return context;
}

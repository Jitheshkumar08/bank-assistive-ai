import type { VoicePreference } from '@/types/voice';

const STORAGE_KEY = 'bank-assistant.voice-preference';

function isPreference(value: string | null): value is VoicePreference {
  return value === 'unset' || value === 'enabled' || value === 'disabled';
}

/**
 * Where the voice choice lives between page loads.
 *
 * sessionStorage, matching tokenStorage and for the same reason: these
 * are shared branch devices, and the next person to pick up the phone
 * should be asked for themselves rather than inheriting a stranger's
 * answer.
 *
 * Every access is guarded. Private browsing and hardened settings make
 * these calls throw rather than return null, and an unreadable
 * preference should mean "ask again", never a crash.
 */
export const voicePreferenceStorage = {
  read(): VoicePreference {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      return isPreference(stored) ? stored : 'unset';
    } catch {
      return 'unset';
    }
  },

  write(preference: VoicePreference): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage unavailable. The choice still holds in memory for this
      // page load, which is enough to finish the visit.
    }
  },

  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do; in-memory state is cleared regardless.
    }
  },
};

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useConversation } from '@/context/useConversation';
import { useSession } from '@/context/useSession';
import { useMicrophone, type MicrophoneStatus } from '@/hooks/useMicrophone';
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback';
import { assistantClient } from '@/services/assistant';
import { voicePreferenceStorage } from '@/lib/voicePreference';
import type { VoiceActivity, VoicePreference } from '@/types/voice';

/**
 * Proof that a recording completed, without keeping the recording.
 *
 * The audio is handed straight to the conversation and then dropped.
 * Only its size and format are kept, so the UI and tests can confirm a
 * recording happened without speech lingering in memory.
 */
export interface RecordingSummary {
  sizeBytes: number;
  mimeType: string;
}

export interface VoiceContextValue {
  preference: VoicePreference;
  /** True only when the customer has explicitly opted in. */
  isEnabled: boolean;
  /** True while the customer has not been asked yet. */
  needsChoice: boolean;

  activity: VoiceActivity;
  /** True whenever voice is mid-turn, so controls can show a busy state. */
  isBusy: boolean;

  /** Microphone lifecycle, surfaced so the control can explain failures. */
  micStatus: MicrophoneStatus;
  micMessage: string | null;
  retryMicrophone: () => void;

  /** Set when a reply could not be spoken. The written reply still stands. */
  speechError: string | null;

  /** Metadata for the last completed recording. Never the audio itself. */
  lastRecording: RecordingSummary | null;

  enable: () => void;
  disable: () => void;

  /** Opens the microphone. The only thing that ever does. */
  startListening: () => void;
  /** Finishes the recording normally. */
  stopListening: () => void;
  /**
   * Hands a finished utterance to the conversation.
   *
   * This is where speech recognition will plug in: STT turns the audio
   * into text, and that text goes through exactly the same send() a
   * typed message uses. Nothing else is added to the pipeline.
   */
  submitUtterance: (text: string) => Promise<void>;

  /**
   * Speech synthesis controls.
   *
   * startSpeaking is exposed for completeness; the spoken reply normally
   * follows a voice turn automatically.
   */
  startSpeaking: () => void;
  stopSpeaking: () => void;

  /**
   * Reads a line aloud that did not come from a conversation turn --
   * the arrival greeting being the one that exists today.
   *
   * Does nothing unless the customer has opted in. Never rejects: the
   * words are always on screen, so an unspoken line is a quieter
   * screen, not a failure.
   */
  speak: (text: string) => Promise<void>;

  /** Safe cancellation from any state. Discards any recording in progress. */
  reset: () => void;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);

/**
 * Owns whether voice assistance is available, and what it is doing.
 *
 * Two ideas kept deliberately apart:
 *
 *   preference  a settled choice that survives navigation
 *   activity    momentary, and only ever started by the customer
 *
 * Enabling voice makes the control usable. It does not open a
 * microphone: only startListening() does that, and only in response to a
 * press. There is no continuous listening anywhere in this provider.
 *
 * Sits inside ConversationProvider because an utterance has to reach the
 * same send() a typed message uses. Voice depends on the conversation;
 * the conversation knows nothing about voice.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { send, sendVoice } = useConversation();
  const { session } = useSession();
  const playback = useSpeechPlayback();

  // Held in a ref so speaking a reply never restarts because the session
  // object changed identity between renders.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = session?.id ?? null;

  const [preference, setPreference] = useState<VoicePreference>(() =>
    voicePreferenceStorage.read(),
  );
  const [activity, setActivity] = useState<VoiceActivity>('idle');
  const [lastRecording, setLastRecording] = useState<RecordingSummary | null>(null);
  // Non-blocking: speech failed but the conversation is unharmed.
  const [speechError, setSpeechError] = useState<string | null>(null);

  // Lets a reset that happens mid-flight discard the result it was
  // waiting for, instead of a stale reply dragging the UI back into
  // 'speaking' after the customer switched voice off.
  const turnRef = useRef(0);

  /**
   * Reads a reply aloud.
   *
   * Failure here is deliberately quiet. The written reply is already on
   * screen, and losing the conversation because speech synthesis had a
   * bad moment would be a far worse outcome than a silent answer.
   */
  const speakReply = useCallback(
    async (text: string, turn: number): Promise<void> => {
      const sessionId = sessionIdRef.current;

      if (!sessionId || !text.trim()) return;

      let audio: Blob;

      try {
        audio = await assistantClient.speak({ sessionId, text });
      } catch {
        setSpeechError('The spoken reply is unavailable. The written answer is above.');
        return;
      }

      // The customer stopped or switched voice off while the audio was
      // being fetched; playing it now would be a reply to nothing.
      if (turnRef.current !== turn) return;

      setActivity('speaking');
      await playback.play(audio);
    },
    [playback],
  );

  const handleRecorded = useCallback(
    async ({ blob, mimeType }: { blob: Blob; mimeType: string }): Promise<void> => {
      setLastRecording({ sizeBytes: blob.size, mimeType });

      const turn = ++turnRef.current;
      setActivity('processing');
      setSpeechError(null);

      try {
        // Straight into the same conversation a typed message uses. The
        // recording is handed over and not kept: nothing stores it, and
        // a failed turn is spoken again rather than resent.
        const reply = await sendVoice(blob, mimeType);

        // A spoken question earns a spoken answer. A typed one does not,
        // which is why this lives here rather than in the conversation.
        if (reply && turnRef.current === turn) {
          await speakReply(reply, turn);
        }
      } finally {
        // A disable or reset while the engine was thinking wins. That
        // turn is no longer current and must not pull the UI back out of
        // rest.
        if (turnRef.current === turn) {
          setActivity('idle');
        }
      }
    },
    [sendVoice, speakReply],
  );

  const {
    status: micStatus,
    message: micMessage,
    start: micStart,
    stop: micStop,
    cancel: micCancel,
    retry: retryMicrophone,
  } = useMicrophone({ onRecorded: handleRecorded });

  // The microphone is the source of truth for 'listening'. Deriving it
  // rather than setting it by hand means the UI cannot claim to be
  // recording when the browser is not.
  useEffect(() => {
    if (micStatus === 'recording') {
      setActivity('listening');
      return;
    }

    setActivity((current) => (current === 'listening' ? 'idle' : current));
  }, [micStatus]);

  const applyPreference = useCallback((next: VoicePreference): void => {
    setPreference(next);
    voicePreferenceStorage.write(next);
  }, []);

  const reset = useCallback((): void => {
    turnRef.current += 1;
    // Anything being recorded is abandoned rather than delivered, and
    // anything being spoken stops mid-sentence.
    micCancel();
    playback.stop();
    setActivity('idle');
    setSpeechError(null);
  }, [micCancel, playback]);

  const enable = useCallback((): void => {
    // This runs inside the tap that turned voice on, which is the only
    // moment a browser will grant permission to play sound. Miss it and
    // the first spoken reply is refused with nothing the customer did
    // wrong -- so consent and permission are taken in the same gesture.
    playback.unlock();

    applyPreference('enabled');
    // Enabling never starts a turn: the customer opts in to the control
    // being available, not to being recorded.
    reset();
  }, [applyPreference, playback, reset]);

  const disable = useCallback((): void => {
    applyPreference('disabled');
    // Stops the recorder, stops every track, discards the audio.
    reset();
  }, [applyPreference, reset]);

  const startListening = useCallback((): void => {
    // Disabled voice cannot start a turn, so a stale control or a stray
    // key press can never open a microphone.
    if (preference !== 'enabled') return;

    // Also a tap, and for someone who chose voice earlier in the visit
    // it is the first one this page load has seen -- their opt-in was
    // remembered, but the browser's permission was not.
    playback.unlock();

    void micStart();
  }, [preference, micStart, playback]);

  const stopListening = useCallback((): void => {
    micStop();
  }, [micStop]);

  const startSpeaking = useCallback((): void => {
    setActivity((current) =>
      current === 'idle' || current === 'processing' ? 'speaking' : current,
    );
  }, []);

  const stopSpeaking = useCallback((): void => {
    playback.stop();
    setActivity((current) => (current === 'speaking' ? 'idle' : current));
  }, [playback]);

  /**
   * Speaks something the customer did not ask a question to receive.
   *
   * Shares speakReply's turn counter, so switching voice off or starting
   * a real turn discards this the same way it discards a stale reply.
   */
  const speak = useCallback(
    async (text: string): Promise<void> => {
      // A greeting is not a reason to override a settled choice.
      if (preference !== 'enabled') return;

      const turn = ++turnRef.current;

      try {
        await speakReply(text, turn);
      } finally {
        if (turnRef.current === turn) setActivity('idle');
      }
    },
    [preference, speakReply],
  );

  const submitUtterance = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();

      if (!trimmed) {
        // Nothing was heard. Returning to rest is the whole response.
        setActivity('idle');
        return;
      }

      const turn = ++turnRef.current;
      setActivity('processing');

      try {
        await send(trimmed);
      } finally {
        // A reset or a disable during the request wins; this turn is no
        // longer the current one and must not touch the UI.
        if (turnRef.current === turn) {
          // Speech synthesis will move this to 'speaking' instead once a
          // reply carries audio. Until then the turn ends here, which is
          // accurate rather than incomplete.
          setActivity('idle');
        }
      }
    },
    [send],
  );

  const value = useMemo<VoiceContextValue>(
    () => ({
      preference,
      isEnabled: preference === 'enabled',
      needsChoice: preference === 'unset',
      activity,
      isBusy: activity !== 'idle',
      micStatus,
      micMessage,
      retryMicrophone,
      speechError,
      lastRecording,
      enable,
      disable,
      startListening,
      stopListening,
      submitUtterance,
      startSpeaking,
      stopSpeaking,
      speak,
      reset,
    }),
    [
      preference,
      activity,
      micStatus,
      micMessage,
      retryMicrophone,
      speechError,
      lastRecording,
      enable,
      disable,
      startListening,
      stopListening,
      submitUtterance,
      startSpeaking,
      stopSpeaking,
      speak,
      reset,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

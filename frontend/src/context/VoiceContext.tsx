import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useConversation } from '@/context/useConversation';
import { useSession } from '@/context/useSession';
import { useMicrophone, type MicrophoneStatus, type StartOptions } from '@/hooks/useMicrophone';
import type { EndpointingConfig } from '@/lib/speechDetector';
import { useSpeechPlayback, type PlaybackOutcome } from '@/hooks/useSpeechPlayback';
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

  /**
   * The microphone's latest input level in dBFS while listening, or null.
   * For a level display only; reading it never re-renders.
   */
  readMicLevel?: () => number | null;

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
 * Pause between a spoken reply ending and the microphone reopening.
 *
 * Long enough for the loudspeaker and the room to fall quiet -- the
 * detector measures the room in its first moments, and the tail of the
 * assistant's own voice must not be what it learns as "quiet" -- and short
 * enough that the conversation still feels continuous.
 */
export const RELISTEN_DELAY_MS = 300;

/** Shown when a voice turn's reply was fetched but could not be played. */
const PLAYBACK_FAILED = 'The spoken reply could not be played. The written answer is above.';

/**
 * Shown when the browser would not let listening resume by itself -- it
 * only allows audio analysis inside a tap -- so the next turn needs one.
 */
const TAP_TO_CONTINUE = 'Tap the microphone when you are ready to speak.';

/** How speaking one reply ended, from the caller's point of view. */
type SpeechOutcome = PlaybackOutcome | 'skipped';

/**
 * Owns whether voice assistance is available, and what it is doing.
 *
 * Three ideas kept deliberately apart:
 *
 *   preference  a settled choice that survives navigation
 *   activity    momentary: idle, listening, processing, speaking
 *   hands-free  whether the conversation continues by itself
 *
 * Enabling voice makes the control usable. It does not open a
 * microphone: only startListening() does that, and only in response to a
 * press.
 *
 * HANDS-FREE LISTENING
 *
 * The press that starts listening also starts a hands-free session. Within
 * it, a turn that ENDS ON ITS OWN (end-of-speech detection) is sent, its
 * reply is read aloud, and -- only once playback has actually finished --
 * the microphone reopens for the next turn. The combined lifecycle:
 *
 *   disabled        preference is not 'enabled'
 *   ready / paused  enabled, no session, activity idle
 *   listening       session on, microphone open (waiting or recording)
 *   processing      the utterance is with the assistant
 *   speaking        the reply is playing
 *   error           a microphone failure, or speechError
 *
 * Any line the assistant reads aloud within the session continues it the
 * same way -- including an offer of help after a quiet spell, and the reply
 * to something typed -- because finishing speaking is what hands the turn
 * back to the customer.
 *
 * Nothing said within the detector's timeout PAUSES the session: the
 * microphone closes, and only the assistant's next line, played to its
 * end, reopens it. Silence alone never reopens anything.
 *
 * The session ends -- and nothing reopens the microphone -- on any of:
 * the customer's own stop, a tap while sending or speaking, disable,
 * reset, a microphone error, a browser that will not measure an automatic
 * reopen, no reply, a reply that could not be played or was interrupted,
 * the visit ending, or this provider unmounting. A reply that cannot be
 * spoken stops the session with a visible message rather than listening
 * again: the customer has to read it, and a loop must never run on
 * failures.
 *
 * Words never control any of this. "Stop" and "wait" are banking-dialogue
 * commands handled by the engine; only on-screen controls stop listening.
 *
 * Sits inside ConversationProvider because an utterance has to reach the
 * same send() a typed message uses. Voice depends on the conversation;
 * the conversation knows nothing about voice.
 */
export interface VoiceProviderProps {
  children: ReactNode;
  /**
   * Pause between a spoken line ending and hands-free listening resuming.
   * Defaults to RELISTEN_DELAY_MS; the app sets its own (lib/voiceTiming).
   */
  relistenDelayMs?: number;
  /**
   * End-of-speech detection settings for the microphone, e.g. how long a
   * silence ends an utterance. Defaults to the CLI recorder's timings; the
   * app sets its own (lib/voiceTiming).
   */
  endpointing?: Partial<EndpointingConfig>;
}

export function VoiceProvider({
  children,
  relistenDelayMs = RELISTEN_DELAY_MS,
  endpointing,
}: VoiceProviderProps) {
  const { send, sendVoice, subscribeToReplies, isSending, ended } = useConversation();

  // Read when a reopen is scheduled, so a changed value never restarts one.
  const relistenDelayRef = useRef(relistenDelayMs);
  relistenDelayRef.current = relistenDelayMs;
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

  // Read at the moment speech is about to start, which always happens in
  // a callback that closed over an earlier render.
  const activityRef = useRef<VoiceActivity>('idle');
  activityRef.current = activity;

  // The hands-free session. A ref, not state: every decision to reopen the
  // microphone happens in a callback that closed over an earlier render,
  // and must see the session as it is NOW.
  const handsFreeRef = useRef(false);
  const relistenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Current values for that same deferred decision.
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  const isSendingRef = useRef(isSending);
  isSendingRef.current = isSending;
  const endedRef = useRef(ended);
  endedRef.current = ended;

  const cancelRelisten = useCallback((): void => {
    if (relistenTimerRef.current !== null) {
      clearTimeout(relistenTimerRef.current);
      relistenTimerRef.current = null;
    }
  }, []);

  /** Ends the hands-free session. Nothing will reopen the microphone. */
  const endHandsFree = useCallback((): void => {
    handsFreeRef.current = false;
    cancelRelisten();
  }, [cancelRelisten]);

  /**
   * Reads a reply aloud, and reports how that ended.
   *
   * Failure here is deliberately quiet for the conversation: the written
   * reply is already on screen, and losing it because speech synthesis had
   * a bad moment would be far worse than a silent answer. Only 'ended'
   * means the customer heard the whole reply.
   */
  const speakReply = useCallback(
    async (text: string, turn: number): Promise<SpeechOutcome> => {
      const sessionId = sessionIdRef.current;

      if (!sessionId || !text.trim()) return 'skipped';

      let audio: Blob;

      try {
        audio = await assistantClient.speak({ sessionId, text });
      } catch {
        setSpeechError('The spoken reply is unavailable. The written answer is above.');
        return 'failed';
      }

      // The customer stopped or switched voice off while the audio was
      // being fetched; playing it now would be a reply to nothing.
      if (turnRef.current !== turn) return 'stopped';

      // The customer is talking. Playing now would talk over them, and
      // the microphone would record the assistant's own voice as their
      // question.
      if (activityRef.current === 'listening') return 'stopped';

      setActivity('speaking');
      return playback.play(audio);
    },
    [playback],
  );

  // The latest microphone start, for a reopen that fires after renders.
  const micStartRef = useRef<(options?: StartOptions) => Promise<void>>(async () => {});
  const micStatusRef = useRef<MicrophoneStatus>('idle');

  /**
   * Reopens the microphone for the next hands-free turn, once.
   *
   * Scheduled only after a reply has played to its end. Every condition is
   * checked again when the timer fires, because anything may have happened
   * in between: a press, a disable, a new request, the visit ending.
   */
  const scheduleRelisten = useCallback(
    (turn: number): void => {
      cancelRelisten();
      if (!handsFreeRef.current) return;

      relistenTimerRef.current = setTimeout(() => {
        relistenTimerRef.current = null;

        // Someone else moved the conversation on; theirs is the next step.
        if (!handsFreeRef.current || turnRef.current !== turn) return;

        const clear =
          preferenceRef.current === 'enabled' &&
          !endedRef.current &&
          !isSendingRef.current &&
          micStatusRef.current === 'idle' &&
          activityRef.current === 'idle';

        if (!clear) {
          endHandsFree();
          return;
        }

        // Like a press: any reply still in flight belongs to nothing now.
        // Unlike a press, there is no tap behind it, which the microphone
        // needs to know (see StartOptions.automatic).
        turnRef.current += 1;
        void micStartRef.current({ automatic: true });
      }, relistenDelayRef.current);
    },
    [cancelRelisten, endHandsFree],
  );

  const handleRecorded = useCallback(
    async ({ blob, mimeType }: { blob: Blob; mimeType: string }): Promise<void> => {
      setLastRecording({ sizeBytes: blob.size, mimeType });

      const turn = ++turnRef.current;
      setActivity('processing');
      setSpeechError(null);
      // A turn is in flight: nothing may reopen the microphone until it
      // has settled.
      cancelRelisten();

      let outcome: SpeechOutcome = 'skipped';

      try {
        // Straight into the same conversation a typed message uses. The
        // recording is handed over and not kept: nothing stores it, and
        // a failed turn is spoken again rather than resent.
        const reply = await sendVoice(blob, mimeType);

        // A spoken question earns a spoken answer. A typed one does not,
        // which is why this lives here rather than in the conversation.
        if (reply && turnRef.current === turn) {
          outcome = await speakReply(reply, turn);

          // Fetched but not heard. Fetch failures already said so.
          if (outcome === 'failed' && turnRef.current === turn) {
            setSpeechError((current) => current ?? PLAYBACK_FAILED);
          }
        }
      } finally {
        // A disable or reset while the engine was thinking wins. That
        // turn is no longer current and must not pull the UI back out of
        // rest -- or reopen the microphone.
        if (turnRef.current === turn) {
          setActivity('idle');

          // Only a reply the customer actually heard continues the
          // conversation. Anything else waits for a tap.
          if (outcome === 'ended') scheduleRelisten(turn);
          else endHandsFree();
        }
      }
    },
    [cancelRelisten, endHandsFree, scheduleRelisten, sendVoice, speakReply],
  );

  const {
    status: micStatus,
    message: micMessage,
    lastEnd: micLastEnd,
    start: micStart,
    stop: micStop,
    cancel: micCancel,
    retry: retryMicrophone,
    readLevel: readMicLevel,
  } = useMicrophone({ onRecorded: handleRecorded, endpointing });

  micStartRef.current = micStart;
  micStatusRef.current = micStatus;

  // A microphone that failed, or an attempt that was cancelled, ends the
  // session. Nothing said ('no_speech') only pauses it: the microphone is
  // already closed, and nothing but the assistant's next spoken line
  // reopens it. Silence is never a turn, and never a reason to keep
  // listening by itself.
  useEffect(() => {
    if (micStatus === 'denied' || micStatus === 'unavailable' || micStatus === 'error') {
      endHandsFree();
    }
  }, [micStatus, endHandsFree]);

  useEffect(() => {
    if (micLastEnd === 'cancelled' || micLastEnd === 'error') {
      endHandsFree();
    }

    // The browser would not let listening resume without a tap. Say so,
    // rather than leaving a resting microphone that looks like a fault.
    if (micLastEnd === 'unmeasurable') {
      endHandsFree();
      setSpeechError(TAP_TO_CONTINUE);
    }
  }, [micLastEnd, endHandsFree]);

  // The visit is over: nothing more to listen for.
  useEffect(() => {
    if (ended) endHandsFree();
  }, [ended, endHandsFree]);

  // No reopen may outlive the provider that scheduled it.
  useEffect(
    () => () => {
      turnRef.current += 1;
      endHandsFree();
    },
    [endHandsFree],
  );

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
    // Ends hands-free first, so nothing the steps below trigger can
    // reopen the microphone.
    endHandsFree();
    // Anything being recorded is abandoned rather than delivered, and
    // anything being spoken stops mid-sentence.
    micCancel();
    playback.stop();
    setActivity('idle');
    setSpeechError(null);
  }, [endHandsFree, micCancel, playback]);

  const enable = useCallback((): void => {
    // Enabling never starts a turn: the customer opts in to the control
    // being available, not to being recorded. Reset first, because reset
    // stops playback -- done after unlocking, it cut the silent clip off
    // mid-play, and a real browser reported that clip as aborted.
    reset();

    // This runs inside the tap that turned voice on, which is the only
    // moment a browser will grant permission to play sound. Miss it and
    // the first spoken reply is refused with nothing the customer did
    // wrong -- so consent and permission are taken in the same gesture.
    playback.unlock();

    applyPreference('enabled');
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

    // This press is the customer choosing a hands-free conversation. It
    // supersedes any reopen already scheduled.
    cancelRelisten();
    handsFreeRef.current = true;

    // The customer has something to say first. A reply still being
    // fetched is discarded and one already playing is stopped, rather
    // than either ending up inside the recording. Done before unlocking,
    // so stopping cannot interrupt the silent clip that buys permission.
    turnRef.current += 1;
    playback.stop();

    // Also a tap, and for someone who chose voice earlier in the visit
    // it is the first one this page load has seen -- their opt-in was
    // remembered, but the browser's permission was not.
    playback.unlock();

    void micStart();
  }, [preference, micStart, playback, cancelRelisten]);

  const stopListening = useCallback((): void => {
    // The customer's own stop: this utterance is still sent, as it always
    // was, but the conversation does not carry on by itself afterwards.
    endHandsFree();
    micStop();
  }, [endHandsFree, micStop]);

  const startSpeaking = useCallback((): void => {
    setActivity((current) =>
      current === 'idle' || current === 'processing' ? 'speaking' : current,
    );
  }, []);

  const stopSpeaking = useCallback((): void => {
    endHandsFree();
    playback.stop();
    setActivity((current) => (current === 'speaking' ? 'idle' : current));
  }, [endHandsFree, playback]);

  /**
   * Speaks a line outside a voice turn: the arrival greeting, and the
   * reply to anything typed while voice is on.
   *
   * Shares speakReply's turn counter, so switching voice off or starting
   * a real turn discards this the same way it discards a stale reply.
   */
  const speak = useCallback(
    async (text: string): Promise<void> => {
      // A greeting is not a reason to override a settled choice.
      if (preference !== 'enabled') return;

      // Also retires any reopen scheduled for an earlier line: that timer
      // checks the turn when it fires, so it cannot cut in on this one.
      const turn = ++turnRef.current;

      let outcome: SpeechOutcome = 'skipped';

      try {
        outcome = await speakReply(text, turn);
      } finally {
        // Undo only what speaking did. The customer may have started
        // recording in the meantime, and dropping that to idle would show
        // a resting microphone while it is still listening.
        if (turnRef.current === turn) {
          setActivity((current) => (current === 'speaking' ? 'idle' : current));

          // Finishing speaking hands the turn back. Within a hands-free
          // session -- running or paused by silence -- listening resumes
          // exactly as it does after a voice turn's reply; outside one,
          // scheduleRelisten does nothing.
          if (outcome === 'ended') scheduleRelisten(turn);
        }
      }
    },
    [preference, speakReply, scheduleRelisten],
  );

  // The latest speak(), so the subscription below is made once rather
  // than torn down and re-made whenever the preference changes.
  const speakRef = useRef(speak);
  speakRef.current = speak;

  /**
   * Reads every typed reply aloud while voice is on.
   *
   * Voice being on is the customer saying they want to hear the
   * assistant, and that does not depend on how they asked this one
   * question. Someone who types because the branch is noisy still wants
   * the answer read out; someone who cannot read the screen needs it.
   *
   * Only text-input replies are taken here. A spoken turn reads its own
   * reply inside handleRecorded, and that turn tracking is what lets a
   * customer who presses the control mid-thought discard the answer.
   * The conversation announces that reply regardless, so taking spoken
   * replies here as well would read out an answer they had abandoned.
   */
  useEffect(
    () =>
      subscribeToReplies(({ text, input }) => {
        if (input !== 'text') return;

        // speak() checks the preference itself, so voice being off or
        // not yet chosen stays silent here as well.
        void speakRef.current(text);
      }),
    [subscribeToReplies],
  );

  const unlockAudio = playback.unlock;

  /**
   * Buys audio permission from the first tap of a page load.
   *
   * A customer who turned voice on earlier in the visit and then
   * reloaded keeps their choice, but not the browser's permission to
   * play sound. If they only type they never press the voice button
   * that would re-grant it, and on iOS every reply is then refused in
   * silence. Any tap will do -- Send, a suggestion, anything -- so the
   * first one is used and the listeners are removed.
   */
  useEffect(() => {
    if (preference !== 'enabled') return;

    const events = ['click', 'touchend', 'keydown'] as const;

    const handleGesture = (): void => {
      unlockAudio();
      for (const name of events) document.removeEventListener(name, handleGesture, true);
    };

    for (const name of events) document.addEventListener(name, handleGesture, true);

    return () => {
      for (const name of events) document.removeEventListener(name, handleGesture, true);
    };
  }, [preference, unlockAudio]);

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
      readMicLevel,
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
      readMicLevel,
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

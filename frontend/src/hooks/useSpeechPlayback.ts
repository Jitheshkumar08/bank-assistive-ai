import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A valid, completely silent WAV: a 44-byte header describing zero
 * samples. Playing it is inaudible and instantaneous, which is exactly
 * what is wanted from a source whose only job is to be played once.
 */
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

/**
 * How one clip's playback ended.
 *
 *   ended    the browser played it to the end ("ended" event) -- the ONLY
 *            outcome that means the customer heard the whole reply
 *   failed   it could not play: refused, undecodable, or nothing to play
 *   stopped  it was interrupted: stop(), a newer clip, or unmount
 */
export type PlaybackOutcome = 'ended' | 'failed' | 'stopped';

export interface SpeechPlayback {
  isSpeaking: boolean;
  /**
   * Plays a spoken reply, resolving with how it ended.
   *
   * Never rejects, because a silent reply is a degraded experience, not a
   * failed conversation. Always settles: a clip that is stopped or
   * replaced resolves 'stopped' rather than leaving its caller waiting.
   */
  play: (audio: Blob) => Promise<PlaybackOutcome>;
  /** Stops immediately and releases the audio. */
  stop: () => void;
  /**
   * Buys permission to play sound later.
   *
   * MUST be called synchronously from inside a real user gesture -- a
   * click or tap handler. Safe to call repeatedly; only the first call
   * does anything.
   */
  unlock: () => void;
}

/**
 * Plays one spoken reply at a time.
 *
 * Three things this guarantees, all of which are easy to get wrong:
 *
 * - Only one clip is ever audible. Starting a new one stops the old one
 *   first, so a customer never hears two replies talking over each other.
 * - Every object URL is revoked. A URL created per reply and never
 *   revoked keeps the audio alive in memory for the life of the page.
 * - Sound can still be played later. Browsers refuse to play audio that
 *   no user asked for, and permission is granted to an *element*, not to
 *   the page -- so one element is created and reused for the life of the
 *   hook rather than a fresh one per clip. An element built at the
 *   moment a reply arrives has no gesture behind it and is refused,
 *   which is how a spoken assistant ends up silent on iOS while working
 *   perfectly on the developer's laptop.
 */
export function useSpeechPlayback(): SpeechPlayback {
  const [isSpeaking, setIsSpeaking] = useState(false);

  // The single element. Created on first use, never replaced.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const unlockedRef = useRef(false);
  // Identifies the current clip, so a clip that was stopped cannot
  // resolve or clear state belonging to the one that replaced it.
  const playbackRef = useRef(0);
  // Settles the current clip's promise. release() detaches the element's
  // handlers, so without this an interrupted clip would never resolve.
  const settleRef = useRef<((outcome: PlaybackOutcome) => void) | null>(null);

  /** Resolves whatever clip is pending as interrupted. */
  const interrupt = useCallback((): void => {
    const settle = settleRef.current;
    settleRef.current = null;
    settle?.('stopped');
  }, []);

  const element = useCallback((): HTMLAudioElement => {
    audioRef.current ??= new Audio();
    return audioRef.current;
  }, []);

  /**
   * Returns the element to rest: nothing playing, no source, no URL
   * held. The element itself survives -- discarding it would throw away
   * the permission a gesture bought.
   */
  const release = useCallback((): void => {
    const audio = audioRef.current;

    if (audio) {
      audio.onended = null;
      audio.onerror = null;

      try {
        audio.pause();
        audio.removeAttribute('src');
        // Abandons the previous source rather than leaving the element
        // holding a decoder for audio nobody will hear.
        audio.load();
      } catch {
        // Already torn down by the browser; nothing to undo.
      }
    }

    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback((): void => {
    playbackRef.current += 1;
    interrupt();
    release();
    setIsSpeaking(false);
  }, [interrupt, release]);

  const unlock = useCallback((): void => {
    if (unlockedRef.current) return;

    // Interrupting a clip to unlock would be absurd: something is
    // already playing, so permission is not in question.
    if (urlRef.current) {
      unlockedRef.current = true;
      return;
    }

    const audio = element();

    try {
      audio.src = SILENCE;

      const started = audio.play?.();

      if (started && typeof started.then === 'function') {
        started
          .then(() => {
            // Only if the element is still holding the silence. A real
            // reply can reach play() between the tap and the moment the
            // browser confirms the silent clip started, and pausing then
            // would cut that reply off before its first word.
            if (audio.getAttribute('src') !== SILENCE) return;

            audio.pause();
            audio.currentTime = 0;
          })
          // Refused anyway. Nothing is broken and nothing was audible;
          // the next real clip simply asks again.
          .catch(() => {});
      }

      // Marked regardless of the outcome. A second attempt outside a
      // gesture would fare no better, and retrying on every tap would
      // interrupt whatever is speaking.
      unlockedRef.current = true;
    } catch {
      // A browser that will not even accept the source is one where
      // there is nothing useful left to try.
    }
  }, [element]);

  const play = useCallback(
    (blob: Blob): Promise<PlaybackOutcome> => {
      // Nothing to play. The text reply is already on screen, so nothing
      // breaks -- but nothing was heard either, so this is not 'ended'.
      if (!blob || blob.size === 0) return Promise.resolve('failed');

      // Whatever was speaking stops before anything new begins, and its
      // caller learns it was interrupted.
      playbackRef.current += 1;
      const playbackId = playbackRef.current;
      interrupt();
      release();

      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      const audio = element();
      audio.src = url;
      setIsSpeaking(true);

      return new Promise<PlaybackOutcome>((resolve) => {
        let settled = false;

        const settle = (outcome: PlaybackOutcome): void => {
          if (settled) return;
          settled = true;
          if (settleRef.current === settle) settleRef.current = null;
          resolve(outcome);
        };

        settleRef.current = settle;

        const finish = (outcome: PlaybackOutcome): void => {
          // A clip that has already been superseded must not clear the
          // state of the one now playing -- and did not finish either.
          if (playbackRef.current !== playbackId) {
            settle('stopped');
            return;
          }

          release();
          setIsSpeaking(false);
          settle(outcome);
        };

        // Only the element's own "ended" event means the reply was heard.
        audio.onended = () => finish('ended');
        audio.onerror = () => finish('failed');

        const started = audio.play?.();

        if (started && typeof started.catch === 'function') {
          // Autoplay refusal, an unsupported codec, or a stopped clip.
          // The customer keeps the written reply either way.
          started.catch(() => finish('failed'));
        }
      });
    },
    [element, interrupt, release],
  );

  // Audio must never outlive the page that started it.
  useEffect(() => {
    return () => {
      playbackRef.current += 1;
      interrupt();
      release();
      audioRef.current = null;
      unlockedRef.current = false;
    };
  }, [interrupt, release]);

  return { isSpeaking, play, stop, unlock };
}

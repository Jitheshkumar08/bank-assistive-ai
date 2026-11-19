import { useCallback, useEffect, useRef } from 'react';
import { composeGreeting } from '@/lib/greeting';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useVoice } from '@/context/useVoice';

export interface UseWelcomeGreetingOptions {
  /**
   * An extra sentence spoken as part of the same utterance -- the
   * remembered payments. One utterance, never two: a second clip a
   * moment later sounds like the assistant interrupting itself.
   */
  suffix?: string | null;
  /**
   * Held back until this is true, so the greeting is not spoken before
   * the suffix is known. Whatever supplies it must guarantee it becomes
   * true -- a greeting that waits forever is worse than a plain one.
   */
  ready?: boolean;
}

export interface WelcomeGreeting {
  /** The exact words being spoken, or null when there is nothing to say. */
  text: string | null;
  /** True when the customer has opted into hearing it. */
  canSpeak: boolean;
  /** Says it again on demand -- the way back from a refused autoplay. */
  replay: () => void;
}

/**
 * Speaks a welcome on arrival.
 *
 * Driven by the act of arriving, not by a memory of having arrived
 * before. An earlier version remembered which branch had been greeted
 * and stayed silent the second time -- which meant a customer who
 * changed their language in settings and typed the same code again got
 * nothing, at exactly the moment they were checking whether the change
 * had worked.
 *
 * So: every scan and every typed code speaks. Walking to the assistant
 * and back does not, because that is not an arrival, and neither is
 * reloading the page onto an existing visit.
 *
 * Deliberately not a blocking step. The written welcome is on screen
 * before this hook does anything, and every failure path here leaves
 * that screen exactly as it is.
 */
export function useWelcomeGreeting(
  options: UseWelcomeGreetingOptions = {},
): WelcomeGreeting {
  const { suffix = null, ready = true } = options;

  const { user } = useAuth();
  const { session, arrivalAt, acknowledgeArrival } = useSession();
  const { speak, isEnabled } = useVoice();

  const greeting =
    user && session
      ? composeGreeting({
          language: session.language,
          fullName: user.fullName,
          branchName: session.branch.name,
        })
      : null;

  // The welcome and the offer are one sentence to the ear.
  const text = greeting && suffix ? greeting + ' ' + suffix : greeting;

  const say = useCallback(
    (line: string) => {
      // Failure is already swallowed inside the voice provider; this
      // only stops an unhandled rejection escaping the effect.
      void speak(line).catch(() => {});
    },
    [speak],
  );

  // The arrival already acted on. Clearing the signal is a state update
  // and does not take effect until the next render, so an effect that
  // runs twice before then -- which StrictMode does on purpose -- would
  // fetch and pay for the same speech twice.
  const handledRef = useRef<number | null>(null);

  useEffect(() => {
    if (arrivalAt === null || handledRef.current === arrivalAt) return;

    // Not yet known whether there is anything to add. Nothing is
    // consumed, so this effect runs again once it is.
    if (!ready) return;

    handledRef.current = arrivalAt;

    // Consumed whether or not it is spoken. Leaving the signal set would
    // mean a customer who turns voice on later in the visit is suddenly
    // greeted for an arrival that happened minutes ago.
    acknowledgeArrival();

    if (!isEnabled || !text) return;

    say(text);
  }, [arrivalAt, acknowledgeArrival, isEnabled, ready, text, say]);

  const replay = useCallback(() => {
    if (text) say(text);
  }, [say, text]);

  return { text, canSpeak: isEnabled, replay };
}

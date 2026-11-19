import { useCallback, useEffect, useRef, useState } from 'react';
import { suggestionsApi } from '@/api/suggestions.api';
import type { Suggestion } from '@/types/suggestions';

/**
 * How long the welcome screen will wait before speaking without them.
 *
 * A personalised greeting that arrives two seconds late is worse than a
 * plain one that arrives at once: the customer has already started
 * reading, and the voice then talks over their attention. Past this the
 * greeting goes ahead alone, and any cards that do arrive simply appear.
 */
export const SUGGESTION_BUDGET_MS = 700;

export interface SuggestionsState {
  suggestions: Suggestion[];
  /**
   * True once the greeting may be spoken: either the suggestions are in,
   * or they have had their budget and lost it. Never stays false.
   */
  settled: boolean;
  /** Removes a card the customer has answered, without a refetch. */
  dismiss: (offerId: string) => void;
}

/**
 * Fetches the remembered payments for this visit, once.
 *
 * Every failure is silent and empty. A welcome screen that cannot think
 * of anything to offer must look exactly like a welcome screen for
 * someone with no history at all -- no error, no empty state, no
 * apology.
 */
export function useSuggestions(sessionId: string | null): SuggestionsState {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [settled, setSettled] = useState(false);

  // The budget timer is cleared on unmount, so a page left early cannot
  // settle a greeting that is no longer on screen.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSuggestions([]);
      setSettled(true);
      return;
    }

    const controller = new AbortController();
    let done = false;

    setSuggestions([]);
    setSettled(false);

    timerRef.current = setTimeout(() => {
      if (!done) setSettled(true);
    }, SUGGESTION_BUDGET_MS);

    suggestionsApi
      .list(sessionId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        done = true;
        setSuggestions(result.suggestions ?? []);
        setSettled(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;

        // Silence, deliberately: the welcome screen stands on its own.
        done = true;
        setSuggestions([]);
        setSettled(true);
      });

    return () => {
      controller.abort();

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId]);

  const dismiss = useCallback((offerId: string) => {
    setSuggestions((current) => current.filter((item) => item.id !== offerId));
  }, []);

  return { suggestions, settled, dismiss };
}

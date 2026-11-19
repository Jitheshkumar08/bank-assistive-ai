import { Link } from 'react-router-dom';
import { SuggestionCard } from './SuggestionCard';
import { suggestionCopy } from '@/lib/suggestionCopy';
import type { Suggestion } from '@/types/suggestions';

interface SuggestionListProps {
  suggestions: readonly Suggestion[];
  language: string;
  /** The offer whose Continue is in flight, if any. */
  busyId?: string | null;
  onContinue: (suggestion: Suggestion) => void;
  onDecline: (suggestion: Suggestion) => void;
}

/**
 * The remembered payments, at most two.
 *
 * The cards say exactly what the greeting said out loud, so nothing is
 * audio-only: a customer in a noisy branch, or one who never turned
 * voice on, loses nothing.
 *
 * "Or ask me anything else" is last and always present. A spoken menu
 * with no way out is a trap, and this is the way out.
 *
 * Announced politely rather than assertively: these appear a moment
 * after the page, and a screen reader should finish the welcome before
 * mentioning them.
 */
export function SuggestionList({
  suggestions,
  language,
  busyId = null,
  onContinue,
  onDecline,
}: SuggestionListProps) {
  const copy = suggestionCopy(language);

  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="welcome-remembered" aria-live="polite" className="mt-8">
      <h2 id="welcome-remembered" className="text-sm font-medium text-ink-900">
        {copy.heading}
      </h2>

      <ul className="mt-3 flex flex-col gap-3">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id}>
            <SuggestionCard
              suggestion={suggestion}
              language={language}
              busy={busyId === suggestion.id}
              onContinue={onContinue}
              onDecline={onDecline}
            />
          </li>
        ))}
      </ul>

      <Link
        to="/assistant"
        className="mt-3 inline-flex min-h-touch items-center text-sm font-medium text-brand-700 transition-colors hover:text-brand-800"
      >
        {copy.askAnything}
      </Link>
    </section>
  );
}

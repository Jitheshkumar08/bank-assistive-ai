import { Button } from '@/components/ui/Button';
import {
  formatAmount,
  formatDayOfMonth,
  isBankVerified,
  suggestionCopy,
} from '@/lib/suggestionCopy';
import type { Suggestion } from '@/types/suggestions';

interface SuggestionCardProps {
  suggestion: Suggestion;
  language: string;
  /** True while this card's Continue is in flight. */
  busy?: boolean;
  onContinue: (suggestion: Suggestion) => void;
  onDecline: (suggestion: Suggestion) => void;
}

/**
 * One remembered payment, offered back.
 *
 * The figures live here rather than in the spoken line: an amount on
 * screen is read by the person holding the phone, an amount spoken
 * aloud is heard by everyone in the queue.
 *
 * A record that did not come from the bank says so, in a badge beside
 * the title and in a line under the detail. The badge is not decoration
 * -- presenting seeded demonstration data as a bank-verified recipient
 * is the one thing this card must never do.
 */
export function SuggestionCard({
  suggestion,
  language,
  busy = false,
  onContinue,
  onDecline,
}: SuggestionCardProps) {
  const copy = suggestionCopy(language);
  const verified = isBankVerified(suggestion.provenance);

  const title =
    suggestion.type === 'RECURRING_TODAY' ? copy.recurringTitle : copy.lastPaymentTitle;

  const detail =
    suggestion.type === 'RECURRING_TODAY' && suggestion.usualDayOfMonth !== null
      ? copy.recurringLine(
          suggestion.payee.displayName,
          formatDayOfMonth(suggestion.usualDayOfMonth, language),
        )
      : copy.payeeLine(suggestion.payee.displayName);

  return (
    <article className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-xs font-medium tracking-[0.1em] text-ink-500 uppercase">{title}</h3>

        {!verified && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-amber-800 uppercase ring-1 ring-amber-200">
            {copy.demoBadge}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-base font-medium text-ink-900">{detail}</p>

      <p className="mt-0.5 text-sm text-ink-500">
        {formatAmount(suggestion.amountMinor, suggestion.currency, language)}
        {suggestion.payee.accountLast4 && (
          <>
            {' · '}
            <span>
              {copy.reviewAccount} ••{suggestion.payee.accountLast4}
            </span>
          </>
        )}
      </p>

      {!verified && <p className="mt-2 text-xs text-ink-500">{copy.demoExplainer}</p>}

      <div className="mt-4 flex gap-2">
        <Button
          size="md"
          fullWidth={false}
          loading={busy}
          onClick={() => onContinue(suggestion)}
          className="flex-1"
        >
          {copy.continueLabel}
        </Button>

        <Button
          variant="ghost"
          size="md"
          fullWidth={false}
          disabled={busy}
          onClick={() => onDecline(suggestion)}
        >
          {copy.declineLabel}
        </Button>
      </div>
    </article>
  );
}

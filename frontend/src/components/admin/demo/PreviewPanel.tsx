import { cn } from '@/lib/cn';
import { describeMoment } from '@/lib/simulatedDate';
import { formatAmount, formatDayOfMonth } from '@/lib/suggestionCopy';
import type { DemoPreview, PreviewCandidate, RecurringFinding } from '@/types/adminDemo';

/**
 * What the personalisation engine concluded, and why.
 *
 * READ ONLY, and deliberately NOT the customer's SuggestionCard. This
 * shows a decision; that card offers to act on one. Keeping them
 * separate means the customer-facing component needs no "preview" mode,
 * no disabled buttons and no new props -- it stays exactly the
 * component that 8 tests already cover.
 *
 * There is no button anywhere in here, and that is a property worth
 * keeping: a panel that cannot act cannot be mistaken for the customer's
 * own screen.
 */

/** Plain English for one payee's recurring verdict, with its numbers. */
export function explainRecurringFinding(
  finding: RecurringFinding,
  thresholds: DemoPreview['recurring']['thresholds'],
): string {
  const { displayName } = finding;

  switch (finding.verdict) {
    case 'MATCHED':
      return `${displayName}: ${finding.distinctMonths} separate months, dates within ${
        finding.spread ?? 0
      } day${finding.spread === 1 ? '' : 's'} of each other${
        finding.fromEnd ? ' counting back from month end' : ''
      }, and the simulated date is ${Math.abs(
        (finding.todayValue ?? 0) - (finding.modal ?? 0),
      )} day(s) from the usual one. A card is offered.`;

    case 'ALREADY_PAID_THIS_MONTH':
      return `${displayName}: already paid in the simulated month, so nothing is offered. This is the rule that stops the assistant inviting someone to pay the same bill twice.`;

    case 'DISTINCT_MONTHS_TOO_FEW':
      return `${displayName}: ${finding.paymentCount} payment${
        finding.paymentCount === 1 ? '' : 's'
      } across only ${finding.distinctMonths} calendar month${
        finding.distinctMonths === 1 ? '' : 's'
      }. A habit needs ${thresholds.minOccurrences} different months — several payments in one week is a busy week, not a pattern.`;

    case 'CLUSTER_TOO_WIDE':
      return `${displayName}: the dates are spread over ${finding.spread} days, wider than the ${thresholds.clusterToleranceDays}-day tolerance, so they are not a monthly habit.`;

    case 'TODAY_OUTSIDE_WINDOW':
      return `${displayName}: the habit falls on ${
        finding.fromEnd ? `${finding.modal} day(s) before month end` : `day ${finding.modal}`
      }, but the simulated date reads ${finding.todayValue}. That is outside the ±${
        thresholds.todayToleranceDays
      }-day window, so the card stays silent today.`;

    default:
      return displayName;
  }
}

/** Plain English for the last-payment verdict. */
export function explainLast(last: DemoPreview['last']): string {
  switch (last.verdict) {
    case 'MATCHED':
      return `The most recent completed payment was to ${last.latestPayeeName}, ${Math.round(
        last.ageHours ?? 0,
      )} hours ago. A card is offered.`;

    case 'NO_PAST_PAYMENTS':
      return 'No completed payment on or before the simulated date, so there is nothing to repeat.';

    case 'TOO_RECENT':
      return `The last payment was only ${Math.round(
        last.ageHours ?? 0,
      )} hours ago, inside the ${
        last.thresholds.minAgeHours
      }-hour quiet period. Someone who paid this morning should not be asked whether they would like to pay again — that is how a duplicate payment starts.`;

    case 'TOO_OLD':
      return `The last payment was ${Math.round(
        (last.ageHours ?? 0) / 24,
      )} days ago, past the ${
        last.thresholds.maxAgeDays
      }-day limit. That is history, not a hint about today.`;

    default:
      return '';
  }
}

interface PreviewPanelProps {
  preview: DemoPreview | null;
  loading: boolean;
}

export function PreviewPanel({ preview, loading }: PreviewPanelProps) {
  if (!preview) {
    return (
      <section
        aria-labelledby="preview-heading"
        className="rounded-2xl bg-white p-5 ring-1 ring-ink-200/70"
      >
        <h2 id="preview-heading" className="text-sm font-semibold text-ink-900">
          Personalisation preview
        </h2>
        <p className="mt-2 text-sm text-ink-500">
          Choose a customer to see what the detectors would conclude.
        </p>
      </section>
    );
  }

  const { recurring, last, gating } = preview;
  const blocked = preview.wouldOffer.length > 0 && !gating.wouldAppearOnWelcome;

  return (
    <section
      aria-labelledby="preview-heading"
      aria-busy={loading}
      className={cn(
        'flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-ink-200/70 transition-opacity',
        loading && 'opacity-60',
      )}
    >
      <header className="flex flex-col gap-1">
        <h2
          id="preview-heading"
          className="text-sm font-semibold tracking-[-0.01em] text-ink-900"
        >
          Personalisation preview
        </h2>
        <p className="text-xs leading-relaxed text-ink-500">
          Evaluated for {describeMoment(preview.evaluatedAt, preview.isSimulated)}. Nothing is
          recorded: no suggestion offer is created and the customer&apos;s session is untouched.
        </p>
      </header>

      {blocked && (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900"
        >
          The rules produce a card, but it would <strong>not</strong> reach the welcome screen:
          {!gating.suggestionsEnabledGlobally && ' SUGGESTIONS_ENABLED is off.'}
          {!gating.accountOptedIn && ' this customer has turned remembered payments off.'}
        </p>
      )}

      {/* Two columns, and only two: this panel lives in a narrow rail,
          where four would each be too tight to read. */}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Figure label="Rows on file" value={preview.historyTotal} />
        <Figure label="Read by detectors" value={preview.historyUsed} tone="brand" />
        <Figure label="Not completed" value={preview.excludedByStatus} />
        <Figure
          label="Out of window"
          value={preview.excludedByWindow + preview.excludedAsFuture}
        />
      </dl>

      <Result
        ordinal="1"
        title="Today's frequent payment"
        verdict={recurring.verdict === 'MATCHED' ? 'offered' : 'silent'}
        candidate={recurring.candidate}
      >
        {recurring.verdict === 'NO_HISTORY_IN_WINDOW' ? (
          <p className="text-xs text-ink-500">
            No completed payments inside the {recurring.thresholds.lookbackDays}-day window.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recurring.findings.map((finding) => {
              const matched = finding.verdict === 'MATCHED';

              return (
                <li
                  key={finding.payeeId}
                  className={cn(
                    'rounded-lg px-2 py-1.5 text-xs leading-relaxed',
                    matched
                      ? 'bg-brand-50 font-medium text-brand-800'
                      : 'bg-ink-50/70 text-ink-600',
                  )}
                >
                  {explainRecurringFinding(finding, recurring.thresholds)}
                </li>
              );
            })}
          </ul>
        )}
      </Result>

      <Result
        ordinal="2"
        title="Last payment"
        verdict={last.verdict === 'MATCHED' ? 'offered' : 'silent'}
        candidate={last.candidate}
      >
        <p
          className={cn(
            'rounded-lg px-2 py-1.5 text-xs leading-relaxed',
            last.verdict === 'MATCHED'
              ? 'bg-brand-50 font-medium text-brand-800'
              : 'bg-ink-50/70 text-ink-600',
          )}
        >
          {explainLast(last)}
        </p>
      </Result>

      {preview.suppressed.length > 0 && (
        <div className="rounded-xl bg-ink-50 px-3 py-2.5">
          <h3 className="text-xs font-semibold text-ink-700">Silenced by past refusals</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {preview.suppressed.map((item) => (
              <li key={`${item.type}-${item.payeeId}`} className="text-xs text-ink-600">
                {item.displayName} — declined {item.declineCount} times recently, so this
                suggestion has stopped asking.
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="border-t border-ink-100 pt-3.5">
        <h3 className="text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
          What the welcome screen would show
        </h3>
        {gating.wouldAppearOnWelcome ? (
          <ol className="mt-2 flex flex-col gap-1.5">
            {preview.wouldOffer.map((item, index) => (
              <li
                key={item.payeeId + item.type}
                className="flex items-center gap-2.5 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-700"
              >
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center rounded-full bg-white text-[0.625rem] font-semibold text-ink-600 ring-1 ring-ink-200 tabular-nums"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-ink-900">
                    {item.type === 'RECURRING_TODAY' ? 'Regular payment' : 'Last payment'}
                  </span>{' '}
                  to {item.displayName} — {formatAmount(item.amountMinor, item.currency, 'en')}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-ink-500">
            The plain welcome greeting, with no cards.
          </p>
        )}
      </footer>
    </section>
  );
}

function Figure({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'brand';
}) {
  return (
    <div
      className={cn(
        'rounded-xl px-3 py-2 ring-1 ring-inset',
        tone === 'brand' ? 'bg-brand-50 ring-brand-100' : 'bg-ink-50 ring-ink-100',
      )}
    >
      <dt className={cn(tone === 'brand' ? 'text-brand-700' : 'text-ink-500')}>{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-lg leading-none font-semibold tabular-nums',
          tone === 'brand' ? 'text-brand-800' : 'text-ink-900',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Result({
  ordinal,
  title,
  verdict,
  candidate,
  children,
}: {
  ordinal: string;
  title: string;
  verdict: 'offered' | 'silent';
  candidate: PreviewCandidate | null;
  children: React.ReactNode;
}) {
  const offered = verdict === 'offered';

  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-xl p-3 ring-1 ring-inset',
        offered ? 'bg-brand-50/30 ring-brand-200' : 'ring-ink-100',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">
          <span className="text-ink-400 tabular-nums">{ordinal}.</span> {title}
        </h3>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
            offered
              ? 'bg-brand-600 text-white ring-brand-700'
              : 'bg-ink-50 text-ink-600 ring-ink-200',
          )}
        >
          {offered ? 'Card offered' : 'No card'}
        </span>
      </div>

      {candidate && (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-ink-800">
          <span className="font-semibold text-ink-900">{candidate.displayName}</span>
          {candidate.accountLast4 && (
            <span className="text-ink-500 tabular-nums">••{candidate.accountLast4}</span>
          )}
          <span className="font-semibold tabular-nums">
            {formatAmount(candidate.amountMinor, candidate.currency, 'en')}
          </span>
          {candidate.usualDayOfMonth !== null && (
            <span className="text-ink-600">
              · usually the {formatDayOfMonth(candidate.usualDayOfMonth, 'en')}
            </span>
          )}
          {!candidate.isBankVerified && (
            <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
              Demo history
            </span>
          )}
        </p>
      )}

      {children}
    </article>
  );
}

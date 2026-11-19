import { cn } from '@/lib/cn';
import { formatAmount } from '@/lib/suggestionCopy';
import type { DemoPaymentRow, IgnoredReason } from '@/types/adminDemo';

interface DemoHistoryTableProps {
  payments: DemoPaymentRow[];
  /** Payee ids the matched pattern was judged on, for highlighting. */
  highlightPayeeId?: string | null;
  highlightDates?: string[];
  /**
   * Both optional, and the actions column appears only when they are
   * given. A read-only table stays exactly read-only -- which is also
   * why every test written for it before writes existed still applies.
   */
  onEdit?: (row: DemoPaymentRow) => void;
  onDelete?: (row: DemoPaymentRow) => void;
  /** The row currently being written, so its controls can rest. */
  busyRowId?: string | null;
}

const IGNORED_LABEL: Record<IgnoredReason, string> = {
  NOT_COMPLETED: 'Not completed',
  OUTSIDE_LOOKBACK: 'Outside the 180-day window',
  FUTURE_DATED: 'Dated after the simulated date',
};

const STATUS_STYLE: Record<DemoPaymentRow['status'], string> = {
  COMPLETED: 'bg-brand-50 text-brand-800 ring-brand-200',
  FAILED: 'bg-rose-50 text-rose-800 ring-rose-200',
  PENDING: 'bg-amber-50 text-amber-900 ring-amber-200',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * One customer's demonstration history.
 *
 * Every row is shown, including the ones no detector will ever see, each
 * with the reason it was left out. A table that silently hid them would
 * make the preview look wrong rather than explain itself.
 *
 * A row that does not count is marked, not faded away: dimmed text is
 * both the least readable way to say it and the least precise, and the
 * reason it was skipped is the useful part.
 */
export function DemoHistoryTable({
  payments,
  highlightPayeeId = null,
  highlightDates = [],
  onEdit,
  onDelete,
  busyRowId = null,
}: DemoHistoryTableProps) {
  const hasActions = onEdit !== undefined || onDelete !== undefined;

  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-ink-50 text-ink-400"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-5">
            <path
              d="M4 7h16M4 12h16M4 17h10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <p className="text-sm font-medium text-ink-900">No demonstration history</p>
        <p className="max-w-sm text-sm text-ink-500">
          The welcome screen would show its plain greeting, with no cards — which is itself a
          valid thing to demonstrate.
        </p>
      </div>
    );
  }

  const highlighted = new Set(highlightDates);

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Demonstration payment history, with whether each row reaches the detectors
        </caption>
        <thead>
          <tr className="border-b border-ink-200/70 bg-ink-50/60 text-[0.6875rem] tracking-[0.1em] text-ink-500 uppercase">
            <th scope="col" className="px-4 py-3 font-semibold">
              Date
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Payee
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              Amount
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Counts?
            </th>
            {hasActions && (
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {payments.map((row) => {
            const isPattern =
              row.payee.id === highlightPayeeId && highlighted.has(row.occurredAt);
            const counts = row.countsTowardSuggestions;

            return (
              <tr
                key={row.id}
                className={cn(
                  'transition-colors',
                  isPattern ? 'bg-brand-50/50 hover:bg-brand-50' : 'hover:bg-ink-50/70',
                  busyRowId === row.id && 'opacity-60',
                )}
              >
                <td className="py-3 pr-4 pl-4 whitespace-nowrap tabular-nums">
                  {/* The accent marks the rows the verdict was actually
                      judged on, so the table and the panel beside it can
                      be read as one answer. */}
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-6 w-0.5 shrink-0 rounded-full',
                        isPattern ? 'bg-brand-500' : 'bg-transparent',
                      )}
                    />
                    <span className={counts ? 'text-ink-900' : 'text-ink-500'}>
                      {formatDate(row.occurredAt)}
                    </span>
                    {isPattern && (
                      <span className="rounded-full bg-brand-100 px-1.5 py-px text-[0.625rem] font-semibold tracking-wide text-brand-800 uppercase">
                        pattern
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('font-medium', counts ? 'text-ink-900' : 'text-ink-600')}>
                    {row.payee.displayName}
                  </span>
                  {row.payee.accountLast4 && (
                    <span className="ml-1.5 text-ink-500 tabular-nums">
                      ••{row.payee.accountLast4}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums',
                    counts ? 'text-ink-900' : 'text-ink-500',
                  )}
                >
                  {formatAmount(row.amountMinor, row.currency, 'en')}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                      STATUS_STYLE[row.status],
                    )}
                  >
                    {row.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {counts ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
                      <CheckGlyph />
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-ink-500">
                      <SkipGlyph />
                      {row.ignoredReason ? IGNORED_LABEL[row.ignoredReason] : 'No'}
                    </span>
                  )}
                </td>
                {hasActions && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="flex items-center justify-end gap-1">
                      {onEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          disabled={busyRowId === row.id}
                          aria-label={`Edit the ${formatDate(row.occurredAt)} payment to ${
                            row.payee.displayName
                          }`}
                          className="inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-semibold text-ink-700 ring-1 ring-transparent transition-colors hover:bg-ink-100 hover:ring-ink-200 disabled:opacity-50"
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(row)}
                          disabled={busyRowId === row.id}
                          aria-label={`Delete the ${formatDate(row.occurredAt)} payment to ${
                            row.payee.displayName
                          }`}
                          className="inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-semibold text-danger-700 ring-1 ring-transparent transition-colors hover:bg-danger-50 hover:ring-danger-500/20 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-3.5">
      <path
        d="m5 13 4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SkipGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-3.5">
      <path d="M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

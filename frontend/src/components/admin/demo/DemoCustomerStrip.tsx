import { cn } from '@/lib/cn';
import type { DemoCustomerSummary } from '@/types/adminDemo';

/**
 * Who is being tested, in one line.
 *
 * Everything here was already fetched -- it was just spread between a
 * dropdown option and the preview's small print. An admin about to
 * clear someone's history should be able to see whose, in which
 * language, and whether that account even wants remembered payments,
 * without reading two panels to assemble it.
 *
 * Counts are deliberately NOT repeated: the row counts belong to the
 * table heading and the preview's figures, and a number shown twice is
 * a number that can disagree with itself.
 */

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
  hi: 'हिंदी',
};

/** Two letters, from however many names there are. */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '—';

  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';

  return (first + last).toUpperCase();
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface DemoCustomerStripProps {
  customer: DemoCustomerSummary;
}

export function DemoCustomerStrip({ customer }: DemoCustomerStripProps) {
  const language = LANGUAGE_LABEL[customer.preferredLanguage] ?? customer.preferredLanguage;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-ink-200/70">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-brand-100"
        >
          {initials(customer.fullName)}
        </span>

        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[0.9375rem] font-semibold text-ink-900">
            {customer.fullName}
          </span>
          <span className="truncate text-xs text-ink-500">{customer.email}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Fact label="Language">{language}</Fact>

        {/*
          The one fact here that can silence every card on its own, so
          it is coloured rather than left to be noticed.
        */}
        <Fact
          label="Remembered payments"
          tone={customer.suggestionsEnabled ? 'neutral' : 'warn'}
        >
          {customer.suggestionsEnabled ? 'On' : 'Off'}
        </Fact>

        <Fact label="Seeded beneficiaries">{customer.demoPayeeCount}</Fact>

        <Fact label="Last payment">
          {customer.lastDemoPaymentAt ? formatDay(customer.lastDemoPaymentAt) : 'None'}
        </Fact>
      </div>
    </div>
  );
}

/** A label and its value, read as one chip rather than two words. */
function Fact({
  label,
  children,
  tone = 'neutral',
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ring-1',
        tone === 'warn'
          ? 'bg-amber-50 text-amber-900 ring-amber-200'
          : 'bg-ink-50 text-ink-800 ring-ink-100',
      )}
    >
      <span className={cn(tone === 'warn' ? 'text-amber-800/80' : 'text-ink-500')}>
        {label}
      </span>
      <span className="font-semibold tabular-nums">{children}</span>
    </span>
  );
}

import { cn } from '@/lib/cn';
import type { AssistanceOffer } from '@/types/assistant';

/** Field types the workflow definitions use, as a customer would name them. */
const FIELD_LABEL: Record<string, string> = {
  account_number: 'Account number',
  amount: 'Amount',
  name: 'Name',
  date: 'Date',
  signature: 'Signature',
};

interface AssistanceCardProps {
  /** The assistant's latest offer of help, if it made one. */
  offer: AssistanceOffer | null;
  /** A step is in progress, so a hint about help is worth showing. */
  stepInProgress: boolean;
  /** Present when no other Help control is on screen. */
  onHelp?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Help that fits where the customer is.
 *
 * While a step is in progress it says how to get help; when the customer
 * has been quiet and the assistant offered help, it shows that offer --
 * already in the visit's language -- and announces it once. It never acts:
 * help is something the customer asks for, never something silence implies.
 */
export function AssistanceCard({
  offer,
  stepInProgress,
  onHelp,
  onDismiss,
  className,
}: AssistanceCardProps) {
  const shown = offer?.offered && offer.text ? offer : null;

  if (!shown && !stepInProgress) return null;

  const field = shown?.field ? FIELD_LABEL[shown.field] : undefined;

  return (
    <section
      aria-label="Help with this step"
      className={cn(
        'mb-2 flex items-start gap-3 rounded-2xl px-4 py-3 ring-1',
        shown ? 'bg-brand-50 ring-brand-200' : 'bg-white ring-ink-200/70',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white"
      >
        ?
      </span>

      <div className="min-w-0 flex-1">
        {field && (
          <p className="text-xs font-medium tracking-[0.08em] text-brand-700 uppercase">{field}</p>
        )}
        {/* Announced when an offer arrives; the hint underneath is not. */}
        <p role="status" aria-live="polite" className="text-[0.9375rem] leading-relaxed text-ink-800">
          {shown ? shown.text : ''}
        </p>
        {!shown && (
          <p className="text-[0.9375rem] leading-relaxed text-ink-600">
            Stuck on this step? Tap Help or say “help”, and I will explain it.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onHelp && (
          <button
            type="button"
            onClick={onHelp}
            className="inline-flex min-h-10 items-center rounded-full bg-white px-3.5 text-sm font-semibold text-brand-700 ring-1 ring-brand-200 transition-colors hover:bg-brand-50"
          >
            Help
          </button>
        )}
        {shown && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss the offer of help"
            className="inline-flex size-10 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-white hover:text-ink-800"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}

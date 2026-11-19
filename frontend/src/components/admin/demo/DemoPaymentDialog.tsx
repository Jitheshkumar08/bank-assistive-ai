import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { fromDateInputValue, toDateInputValue } from '@/lib/simulatedDate';
import type {
  CreateDemoPaymentInput,
  DemoPaymentRow,
  DemoPaymentStatus,
  DemoPayeeView,
  UpdateDemoPaymentInput,
} from '@/types/adminDemo';

const STATUSES: DemoPaymentStatus[] = ['COMPLETED', 'FAILED', 'PENDING'];

const STATUS_HINT: Record<DemoPaymentStatus, string> = {
  COMPLETED: 'Counts towards suggestions.',
  FAILED: 'Ignored by both detectors — useful for showing that a failed payment suggests nothing.',
  PENDING: 'Ignored by both detectors until it completes.',
};

const NEW_PAYEE = '__new__';

interface DemoPaymentDialogProps {
  /** Existing demonstration beneficiaries of this customer. */
  payees: DemoPayeeView[];
  /** The row being edited, or null when adding. */
  editing: DemoPaymentRow | null;
  /** Date a new row defaults to, usually the simulated one. */
  defaultOccurredAt: string;
  /** Ceiling in minor units, mirrored from the server for early feedback. */
  maxAmountMinor: number;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onCreate: (input: CreateDemoPaymentInput) => void;
  onUpdate: (input: UpdateDemoPaymentInput) => void;
}

/**
 * Adding or changing one demonstration payment.
 *
 * Amounts are entered in WHOLE RUPEES and multiplied by 100 on the way
 * out. Money is never a float here: letting someone type 49.99 would
 * mean parsing a decimal into paise, and the one thing worth being
 * fussy about in a money form is that the integer arithmetic stays
 * integer.
 *
 * The server validates all of this again. The checks here exist so a
 * mistake is caught before a round trip, not instead of being caught.
 */
export function DemoPaymentDialog({
  payees,
  editing,
  defaultOccurredAt,
  maxAmountMinor,
  busy = false,
  error = null,
  onCancel,
  onCreate,
  onUpdate,
}: DemoPaymentDialogProps) {
  const isEditing = editing !== null;

  const [payeeChoice, setPayeeChoice] = useState<string>(
    editing?.payee.id ?? payees[0]?.id ?? NEW_PAYEE,
  );
  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [rupees, setRupees] = useState(
    editing ? String(Math.round(editing.amountMinor / 100)) : '',
  );
  const [dateValue, setDateValue] = useState(
    toDateInputValue(editing?.occurredAt ?? defaultOccurredAt),
  );
  const [status, setStatus] = useState<DemoPaymentStatus>(editing?.status ?? 'COMPLETED');
  const [localError, setLocalError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus the dialog when it opens, so a keyboard user is inside it
  // rather than still on the button that opened it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const creatingPayee = !isEditing && payeeChoice === NEW_PAYEE;

  function validate(): { amountMinor: number; occurredAt: string } | null {
    if (!/^\d+$/.test(rupees.trim())) {
      setLocalError('Enter the amount as a whole number of rupees.');
      return null;
    }

    const amountMinor = Number(rupees.trim()) * 100;

    if (amountMinor < 100) {
      setLocalError('The amount must be at least ₹1.');
      return null;
    }

    if (amountMinor > maxAmountMinor) {
      setLocalError(
        `The amount must be at most ₹${Math.floor(maxAmountMinor / 100).toLocaleString(
          'en-IN',
        )} — the same limit the customer review screen enforces.`,
      );
      return null;
    }

    const occurredAt = fromDateInputValue(dateValue);

    if (!occurredAt) {
      setLocalError('Choose a valid date.');
      return null;
    }

    if (creatingPayee) {
      if (displayName.trim().length === 0) {
        setLocalError('Enter the payee name.');
        return null;
      }

      // Digits in a name would end up in the SPOKEN line, where no
      // digit may ever appear.
      if (/\d/.test(displayName)) {
        setLocalError('A payee name must be letters only — no digits.');
        return null;
      }

      if (!/^\d{4}$/.test(accountLast4.trim())) {
        setLocalError('Enter exactly the last four digits of the account.');
        return null;
      }
    }

    setLocalError(null);

    return { amountMinor, occurredAt };
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();

    const valid = validate();

    if (!valid) return;

    if (isEditing) {
      const changes: UpdateDemoPaymentInput = {};

      if (payeeChoice !== editing.payee.id) changes.payeeId = payeeChoice;
      if (valid.amountMinor !== editing.amountMinor) changes.amountMinor = valid.amountMinor;
      if (valid.occurredAt !== editing.occurredAt) changes.occurredAt = valid.occurredAt;
      if (status !== editing.status) changes.status = status;

      if (Object.keys(changes).length === 0) {
        setLocalError('Nothing has been changed.');
        return;
      }

      onUpdate(changes);
      return;
    }

    onCreate({
      ...(creatingPayee
        ? {
            newPayee: {
              displayName: displayName.trim(),
              ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
              accountLast4: accountLast4.trim(),
            },
          }
        : { payeeId: payeeChoice }),
      amountMinor: Number(rupees.trim()) * 100,
      occurredAt: fromDateInputValue(dateValue)!,
      status,
    });
  }

  const shown = localError ?? error;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-payment-dialog-title"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-[0_24px_48px_-12px_rgb(16_24_40/0.25)] ring-1 ring-ink-900/5 sm:p-6"
      >
        <h2
          id="demo-payment-dialog-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold tracking-[-0.01em] text-ink-900 focus-visible:outline-none sm:text-lg"
        >
          {isEditing ? 'Edit demonstration payment' : 'Add demonstration payment'}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Demonstration data only. This records a payment that is pretended to have happened — it
          does not move money.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-800">Payee</span>
            <select
              value={payeeChoice}
              onChange={(event) => setPayeeChoice(event.target.value)}
              className="min-h-touch w-full rounded-xl border border-ink-200 bg-white px-3 text-base text-ink-900 focus:border-brand-600 focus:ring-4 focus:ring-brand-500/25 focus-visible:outline-none"
            >
              {payees.map((payee) => (
                <option key={payee.id} value={payee.id}>
                  {payee.displayName}
                  {payee.accountLast4 ? ` ••${payee.accountLast4}` : ''}
                </option>
              ))}
              {!isEditing && <option value={NEW_PAYEE}>New payee…</option>}
            </select>
          </label>

          {creatingPayee && (
            <div className="flex flex-col gap-3 rounded-xl bg-ink-50 p-3">
              <Field
                label="Name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                hint="Spoken aloud, so letters only — no digits."
                autoComplete="off"
                required
              />
              <Field
                label="Full name (optional)"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="off"
              />
              <Field
                label="Account, last 4 digits"
                value={accountLast4}
                onChange={(event) => setAccountLast4(event.target.value)}
                inputMode="numeric"
                maxLength={4}
                hint="Four digits. There is no field anywhere for a full account number."
                autoComplete="off"
                required
              />
            </div>
          )}

          <Field
            label="Amount in rupees"
            value={rupees}
            onChange={(event) => setRupees(event.target.value)}
            inputMode="numeric"
            hint={`Whole rupees, ₹1 to ₹${Math.floor(maxAmountMinor / 100).toLocaleString(
              'en-IN',
            )}. INR only.`}
            autoComplete="off"
            required
          />

          <Field
            label="Date"
            type="date"
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
            hint="A future date is allowed; the detectors will ignore it."
            required
          />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-ink-800">Status</legend>
            {/*
              Each option is a whole row rather than a bare dot: the
              status is the field that decides whether a row reaches the
              detectors at all, so its explanation is part of choosing.
            */}
            <div className="flex flex-col gap-1.5">
              {STATUSES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset transition-colors',
                    status === value
                      ? 'bg-brand-50/60 ring-brand-300'
                      : 'ring-ink-200 hover:bg-ink-50',
                  )}
                >
                  <input
                    type="radio"
                    name="status"
                    value={value}
                    checked={status === value}
                    onChange={() => setStatus(value)}
                    className="mt-0.5 size-4 accent-brand-600"
                  />
                  <span>
                    <span className="font-medium text-ink-900">{value.toLowerCase()}</span>
                    <span className="block text-xs text-ink-500">{STATUS_HINT[value]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {shown && <Alert tone="error">{shown}</Alert>}

          <div className="flex gap-2.5 border-t border-ink-100 pt-4">
            <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="md" loading={busy}>
              {isEditing ? 'Save changes' : 'Add payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

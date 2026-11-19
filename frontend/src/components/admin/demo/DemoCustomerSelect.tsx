import type { DemoCustomerSummary } from '@/types/adminDemo';

interface DemoCustomerSelectProps {
  customers: DemoCustomerSummary[];
  selectedId: string | null;
  onSelect: (userId: string) => void;
  disabled?: boolean;
}

/**
 * Which customer's personalisation is being tested.
 *
 * The row count is shown beside each name because it is the one thing
 * that decides whether this account has anything to demonstrate, and
 * an account with none is a perfectly valid thing to test -- it should
 * produce the plain welcome screen.
 */
export function DemoCustomerSelect({
  customers,
  selectedId,
  onSelect,
  disabled = false,
}: DemoCustomerSelectProps) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[0.6875rem] font-semibold tracking-[0.12em] text-ink-500 uppercase">
        Demo customer
      </span>

      <select
        value={selectedId ?? ''}
        disabled={disabled || customers.length === 0}
        onChange={(event) => onSelect(event.target.value)}
        className="min-h-touch w-full rounded-xl bg-white px-3 text-[0.9375rem] text-ink-900 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200 ring-inset hover:ring-ink-300 focus:ring-2 focus:ring-brand-500/50 focus-visible:outline-none disabled:text-ink-400"
      >
        {customers.length === 0 ? (
          <option value="">No customer accounts</option>
        ) : (
          <>
            <option value="" disabled>
              Choose a customer…
            </option>
            {customers.map((customer) => (
              <option key={customer.userId} value={customer.userId}>
                {customer.email}
                {' — '}
                {customer.demoPaymentCount === 0
                  ? 'no demo history'
                  : `${customer.demoPaymentCount} demo payment${
                      customer.demoPaymentCount === 1 ? '' : 's'
                    }`}
              </option>
            ))}
          </>
        )}
      </select>
    </label>
  );
}

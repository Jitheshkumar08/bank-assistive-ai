import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminDemoPage } from './AdminDemoPage';
import { ApiError } from '@/types/api';
import { localNoonIso, toDateInputValue } from '@/lib/simulatedDate';
import type {
  DemoCustomerSummary,
  DemoPaymentsView,
  DemoPreview,
  DemoResetResult,
  DemoRestoreResult,
} from '@/types/adminDemo';

/**
 * The testing dashboard, assembled.
 *
 * The property worth defending here is CONSISTENCY: the table and the
 * verdict must always describe the same moment. They are two requests,
 * so a careless implementation could easily annotate rows against one
 * date and explain a verdict for another, which would look like a
 * detector bug and waste an afternoon.
 */

const customers = vi.fn<() => Promise<DemoCustomerSummary[]>>();
const payments = vi.fn<(userId: string, at: string | null) => Promise<DemoPaymentsView>>();
const preview = vi.fn<(userId: string, at: string | null) => Promise<DemoPreview>>();
const create = vi.fn<(userId: string, input: unknown) => Promise<unknown>>();
const update = vi.fn<(userId: string, paymentId: string, input: unknown) => Promise<unknown>>();
const remove = vi.fn<(userId: string, paymentId: string) => Promise<void>>();
const reset = vi.fn<(userId: string) => Promise<DemoResetResult>>();
const restore = vi.fn<(userId: string) => Promise<DemoRestoreResult>>();

vi.mock('@/api/adminDemo.api', () => ({
  adminDemoApi: {
    customers: () => customers(),
    payments: (userId: string, at: string | null) => payments(userId, at),
    preview: (userId: string, at: string | null) => preview(userId, at),
    create: (userId: string, input: unknown) => create(userId, input),
    update: (userId: string, paymentId: string, input: unknown) =>
      update(userId, paymentId, input),
    remove: (userId: string, paymentId: string) => remove(userId, paymentId),
    reset: (userId: string) => reset(userId),
    restore: (userId: string) => restore(userId),
  },
}));

const CUSTOMER: DemoCustomerSummary = {
  userId: 'user-1',
  email: 'demo@bankassist.local',
  fullName: 'Demo Customer',
  preferredLanguage: 'en',
  suggestionsEnabled: true,
  demoPaymentCount: 6,
  demoPayeeCount: 2,
  lastDemoPaymentAt: '2026-11-11T06:30:00.000Z',
};

const SPARSE: DemoCustomerSummary = {
  ...CUSTOMER,
  userId: 'user-2',
  email: 'empty@bankassist.local',
  demoPaymentCount: 0,
  demoPayeeCount: 0,
  lastDemoPaymentAt: null,
};

const RAHUL = {
  id: 'payee-rahul',
  displayName: 'Rahul',
  fullName: 'Rahul Shetty',
  accountLast4: '4821',
  trust: 'DEMO_SEEDED' as const,
};

function paymentsView(overrides: Partial<DemoPaymentsView> = {}): DemoPaymentsView {
  return {
    customer: CUSTOMER,
    evaluatedAt: '2026-11-16T12:00:00.000Z',
    isSimulated: false,
    lookbackStart: '2026-05-20T12:00:00.000Z',
    payments: [
      {
        id: 'row-1',
        payee: RAHUL,
        amountMinor: 500_000,
        currency: 'INR',
        status: 'COMPLETED',
        occurredAt: '2026-10-16T06:30:00.000Z',
        createdAt: '2026-10-16T06:30:00.000Z',
        countsTowardSuggestions: true,
        ignoredReason: null,
      },
      {
        id: 'row-2',
        payee: RAHUL,
        amountMinor: 500_000,
        currency: 'INR',
        status: 'FAILED',
        occurredAt: '2026-11-14T06:30:00.000Z',
        createdAt: '2026-11-14T06:30:00.000Z',
        countsTowardSuggestions: false,
        ignoredReason: 'NOT_COMPLETED',
      },
    ],
    ...overrides,
  };
}

function previewView(overrides: Partial<DemoPreview> = {}): DemoPreview {
  return {
    customer: CUSTOMER,
    evaluatedAt: '2026-11-16T12:00:00.000Z',
    isSimulated: false,
    lookbackStart: '2026-05-20T12:00:00.000Z',
    gating: {
      suggestionsEnabledGlobally: true,
      accountOptedIn: true,
      demoHistoryEnabled: true,
      wouldAppearOnWelcome: true,
    },
    historyTotal: 2,
    historyUsed: 1,
    excludedByStatus: 1,
    excludedByWindow: 0,
    excludedAsFuture: 0,
    recurring: {
      verdict: 'MATCHED',
      thresholds: {
        lookbackDays: 180,
        minOccurrences: 3,
        clusterToleranceDays: 3,
        todayToleranceDays: 2,
      },
      findings: [
        {
          payeeId: 'payee-rahul',
          displayName: 'Rahul',
          verdict: 'MATCHED',
          paymentCount: 5,
          distinctMonths: 5,
          spread: 0,
          modal: 16,
          fromEnd: false,
          todayValue: 16,
          representativeDates: ['2026-10-16T06:30:00.000Z'],
        },
      ],
      candidate: {
        type: 'RECURRING_TODAY',
        payeeId: 'payee-rahul',
        displayName: 'Rahul',
        accountLast4: '4821',
        amountMinor: 500_000,
        currency: 'INR',
        lastOccurredAt: '2026-10-16T06:30:00.000Z',
        provenance: 'DEMO_HISTORY',
        isBankVerified: false,
        occurrenceCount: 5,
        usualDayOfMonth: 16,
      },
    },
    last: {
      verdict: 'NO_PAST_PAYMENTS',
      thresholds: { maxAgeDays: 60, minAgeHours: 24 },
      latestOccurredAt: null,
      latestPayeeId: null,
      latestPayeeName: null,
      ageHours: null,
      candidate: null,
    },
    wouldOffer: [
      {
        type: 'RECURRING_TODAY',
        payeeId: 'payee-rahul',
        displayName: 'Rahul',
        accountLast4: '4821',
        amountMinor: 500_000,
        currency: 'INR',
        lastOccurredAt: '2026-10-16T06:30:00.000Z',
        provenance: 'DEMO_HISTORY',
        isBankVerified: false,
        occurrenceCount: 5,
        usualDayOfMonth: 16,
      },
    ],
    suppressed: [],
    unresolvedPayeeIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  customers.mockReset();
  payments.mockReset();
  preview.mockReset();
  create.mockReset();
  update.mockReset();
  remove.mockReset();
  reset.mockReset();
  restore.mockReset();

  customers.mockResolvedValue([CUSTOMER, SPARSE]);
  payments.mockResolvedValue(paymentsView());
  preview.mockResolvedValue(previewView());
  create.mockResolvedValue({ id: 'row-new' });
  update.mockResolvedValue({ id: 'row-1' });
  remove.mockResolvedValue(undefined);
  reset.mockResolvedValue({
    customer: { ...CUSTOMER, demoPaymentCount: 0, demoPayeeCount: 0 },
    paymentsDeleted: 9,
    payeesDeleted: 3,
    payeesRetained: 0,
  });
  restore.mockResolvedValue({
    customer: { ...CUSTOMER, demoPaymentCount: 9, demoPayeeCount: 3 },
    cleared: { paymentsDeleted: 2, payeesDeleted: 0, payeesRetained: 0 },
    payeesCreated: 3,
    payeesReused: 0,
    paymentsCreated: 9,
  });
});

describe('AdminDemoPage', () => {
  it('marks itself as a development-only screen', async () => {
    render(<AdminDemoPage />);

    expect(await screen.findByText(/development only/i)).toBeInTheDocument();
    expect(screen.getByText(/not bank statements/i)).toBeInTheDocument();
  });

  it('selects the customer with the most history first', async () => {
    render(<AdminDemoPage />);

    await waitFor(() => expect(preview).toHaveBeenCalled());

    expect(preview).toHaveBeenCalledWith('user-1', null);
    expect(payments).toHaveBeenCalledWith('user-1', null);
  });

  it('shows every row, including the one no detector reads', async () => {
    render(<AdminDemoPage />);

    // Scoped to the table: "Not completed" is also one of the preview's
    // figures, and both saying it is correct.
    const table = await screen.findByRole('table');

    expect(within(table).getByText('Not completed')).toBeInTheDocument();
    // Both rows, not just the usable one.
    expect(within(table).getAllByText('Rahul')).toHaveLength(2);
    expect(screen.getByText(/1 read by the detectors/i)).toBeInTheDocument();
  });

  it('asks the table and the preview about THE SAME moment', async () => {
    render(<AdminDemoPage />);

    await waitFor(() => expect(preview).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '15th' }));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));

    const paymentsAt = payments.mock.calls[payments.mock.calls.length - 1][1];
    const previewAt = preview.mock.calls[preview.mock.calls.length - 1][1];

    expect(paymentsAt).toBe(previewAt);
    expect(toDateInputValue(previewAt!)).toMatch(/-15$/);
  });

  it('re-evaluates when the date is stepped a day', async () => {
    render(<AdminDemoPage />);

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /next day/i }));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));

    const previewAt = preview.mock.calls[1][1];

    expect(previewAt).not.toBeNull();
  });

  it('returns to the real present when asked', async () => {
    render(<AdminDemoPage />);

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: '1st' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole('button', { name: /today \(real\)/i }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(3));

    expect(preview.mock.calls[2][1]).toBeNull();
  });

  it('re-evaluates when another customer is chosen', async () => {
    render(<AdminDemoPage />);

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /demo customer/i }),
      'user-2',
    );

    await waitFor(() => expect(preview).toHaveBeenCalledWith('user-2', null));
  });

  it('treats an account with no history as a valid thing to demonstrate', async () => {
    payments.mockResolvedValue(paymentsView({ customer: SPARSE, payments: [] }));

    render(<AdminDemoPage />);

    expect(await screen.findByText(/no demonstration history/i)).toBeInTheDocument();
    expect(screen.getByText(/plain greeting/i)).toBeInTheDocument();
  });

  it('explains itself rather than erroring when the feature is switched off', async () => {
    customers.mockRejectedValue(new ApiError('Not found.', 404));

    render(<AdminDemoPage />);

    expect(await screen.findByText(/not available here/i)).toBeInTheDocument();
    expect(screen.getByText(/DEMO_DASHBOARD_ENABLED/)).toBeInTheDocument();
    // And it does not then go on to ask about a customer.
    expect(preview).not.toHaveBeenCalled();
  });

  it('reports a genuine failure as a failure', async () => {
    customers.mockRejectedValue(new ApiError('Server exploded.', 500));

    render(<AdminDemoPage />);

    expect(await screen.findByText(/server exploded/i)).toBeInTheDocument();
    expect(screen.queryByText(/not available here/i)).not.toBeInTheDocument();
  });

  it('never shows more of an account than its last four digits', async () => {
    render(<AdminDemoPage />);

    await waitFor(() => expect(preview).toHaveBeenCalled());

    // 4821 is a mask. A five-digit run would not be -- amounts are
    // rendered with separators, so they cannot produce one either.
    expect(document.body.textContent).not.toMatch(/\d{5,}/);
  });

  it('offers no control that could act on a customer\'s behalf', async () => {
    render(<AdminDemoPage />);

    await waitFor(() => expect(preview).toHaveBeenCalled());

    const buttons = screen.getAllByRole('button').map((button) => button.textContent ?? '');

    // Editing demonstration DATA is the job. Acting as the customer is
    // not: nothing here continues, confirms or pays anything.
    for (const label of buttons) {
      expect(label).not.toMatch(/continue|confirm|\bpay\b/i);
    }
  });

  it('keeps the previous verdict on screen while the next one loads', async () => {
    render(<AdminDemoPage />);

    await screen.findByText(/card offered/i);

    let release: (value: DemoPreview) => void = () => {};
    preview.mockReturnValue(new Promise<DemoPreview>((resolve) => (release = resolve)));

    await userEvent.click(screen.getByRole('button', { name: '15th' }));

    // Still readable, just marked busy -- not blanked.
    expect(screen.getByText(/card offered/i)).toBeInTheDocument();

    release(previewView({ evaluatedAt: localNoonIso(2026, 11, 15), isSimulated: true }));

    // Parenthesised: the control's own "Simulated date" label is not
    // what is being asserted here, the evaluated moment is.
    await waitFor(() => expect(screen.getByText(/\(simulated\)/)).toBeInTheDocument());
  });
});

describe('AdminDemoPage writes', () => {
  async function ready() {
    render(<AdminDemoPage />);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  }

  it('adds a record and REFRESHES ALL THREE reads', async () => {
    await ready();

    const customersBefore = customers.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));
    await userEvent.type(screen.getByLabelText(/amount in rupees/i), '2500');
    // The page's own button and the dialog's submit both read "Add
    // payment"; the dialog's comes last in the document.
    await userEvent.click(screen.getAllByRole('button', { name: /add payment/i }).at(-1)!);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith('user-1', expect.objectContaining({ amountMinor: 250_000 }));

    // Counts, history and preview all re-read, so a stale row count or
    // a stale verdict cannot survive a write.
    await waitFor(() => expect(customers.mock.calls.length).toBe(customersBefore + 1));
    await waitFor(() => expect(payments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  });

  it('keeps the simulated date across a write', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: '15th' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));

    const simulated = preview.mock.calls[1][1];

    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));
    await userEvent.type(screen.getByLabelText(/amount in rupees/i), '1000');
    await userEvent.click(screen.getAllByRole('button', { name: /add payment/i }).at(-1)!);

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(3));

    // Same moment as before the write, for the table AND the preview.
    expect(preview.mock.calls[2][1]).toBe(simulated);
    expect(payments.mock.calls[2][1]).toBe(simulated);
  });

  it('edits a record, sending only what changed', async () => {
    await ready();

    await userEvent.click(screen.getAllByRole('button', { name: /^edit the/i })[0]);
    await userEvent.click(screen.getByRole('radio', { name: /pending/i }));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('user-1', 'row-1', { status: 'PENDING' });
  });

  it('ASKS BEFORE DELETING, and names what will go', async () => {
    await ready();

    await userEvent.click(screen.getAllByRole('button', { name: /^delete the/i })[0]);

    // Nothing has happened yet.
    expect(remove).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: /delete this demonstration payment/i });

    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Rahul/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('user-1', 'row-1'));
  });

  it('deletes nothing when the confirmation is declined', async () => {
    await ready();

    await userEvent.click(screen.getAllByRole('button', { name: /^delete the/i })[0]);
    await userEvent.click(screen.getByRole('button', { name: /keep it/i }));

    expect(remove).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', { name: /delete this demonstration payment/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the server\'s refusal and leaves the screen as it was', async () => {
    create.mockRejectedValue(new ApiError('That payee is not a demonstration beneficiary.', 422));

    await ready();

    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));
    await userEvent.type(screen.getByLabelText(/amount in rupees/i), '2500');
    await userEvent.click(screen.getAllByRole('button', { name: /add payment/i }).at(-1)!);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/not a demonstration beneficiary/i),
    );

    // The dialog stays open with the entered values, and nothing was
    // re-read: a failed write changes nothing.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(payments).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('offers no write controls before a customer is chosen', async () => {
    customers.mockResolvedValue([]);

    render(<AdminDemoPage />);

    await waitFor(() => expect(customers).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /add payment/i })).not.toBeInTheDocument();
  });
});

/**
 * Clearing and restoring.
 *
 * Both act on everything at once, so the question before them is the
 * feature -- and what they report afterwards matters nearly as much:
 * an emptied table and a restored one both look plausible, so the page
 * says what actually happened rather than leaving it to be inferred.
 */
describe('AdminDemoPage clearing and restoring', () => {
  async function ready() {
    render(<AdminDemoPage />);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  }

  it('ASKS BEFORE CLEARING, and says what is spared', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));

    // Nothing has happened yet.
    expect(reset).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: /clear this customer's demonstration/i });

    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 demonstration records/i)).toBeInTheDocument();
    // The limits of the action, stated before it is taken.
    expect(
      within(dialog).getByText(/customer entered themselves are left alone/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/no assisted activity/i)).toBeInTheDocument();
  });

  it('clears nothing when the confirmation is declined', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));
    await userEvent.click(screen.getByRole('button', { name: /keep it/i }));

    expect(reset).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', { name: /clear this customer's demonstration/i }),
    ).not.toBeInTheDocument();
  });

  it('clears, REPORTS THE COUNTS, and refreshes all three reads', async () => {
    await ready();

    const customersBefore = customers.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^clear history$/i }),
    );

    await waitFor(() => expect(reset).toHaveBeenCalledWith('user-1'));

    // Said plainly, because an empty table alone does not distinguish
    // "cleared nine" from "there were none".
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /cleared 9 payments and 3 beneficiaries/i,
      ),
    );

    await waitFor(() => expect(customers.mock.calls.length).toBe(customersBefore + 1));
    await waitFor(() => expect(payments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  });

  it('EXPLAINS A BENEFICIARY IT COULD NOT REMOVE', async () => {
    reset.mockResolvedValue({
      customer: { ...CUSTOMER, demoPaymentCount: 0, demoPayeeCount: 1 },
      paymentsDeleted: 9,
      payeesDeleted: 2,
      payeesRetained: 1,
    });

    await ready();

    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^clear history$/i }),
    );

    // Not silence: a beneficiary left behind would otherwise look like
    // the clear having failed.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /1 beneficiary was kept: an assisted activity or an earlier suggestion still refers/i,
      ),
    );
  });

  it('ASKS BEFORE RESTORING, and says what the fixture is', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /restore seeded history/i }));

    expect(restore).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: /restore the seeded demonstration/i });

    expect(within(dialog).getByText(/monthly habit due today/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/deliberately not a habit/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('restores, and reports what it replaced', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /restore seeded history/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^restore$/i }),
    );

    await waitFor(() => expect(restore).toHaveBeenCalledWith('user-1'));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /restored 9 payments across 3 beneficiaries, replacing 2 that were there before/i,
      ),
    );

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  });

  it('keeps the simulated date across a restore', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: '15th' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));

    const simulated = preview.mock.calls[1][1];

    await userEvent.click(screen.getByRole('button', { name: /restore seeded history/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^restore$/i }),
    );

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(3));

    // The table and the verdict still describe the same moment as
    // before, so a restore does not quietly reset the date too.
    expect(preview.mock.calls[2][1]).toBe(simulated);
    expect(payments.mock.calls[2][1]).toBe(simulated);
  });

  it('shows the server\'s refusal in the dialog and changes nothing', async () => {
    reset.mockRejectedValue(new ApiError('Not found.', 404));

    await ready();

    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^clear history$/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/not found/i),
    );

    // The question stays open, nothing was re-read, and no success was
    // announced.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(payments).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Cleared /)).not.toBeInTheDocument();
  });

  it('offers nothing to clear when there is nothing to clear', async () => {
    payments.mockResolvedValue(
      paymentsView({
        customer: { ...CUSTOMER, demoPaymentCount: 0, demoPayeeCount: 0 },
        payments: [],
      }),
    );

    await ready();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /clear history/i })).toBeDisabled(),
    );
    // Restoring, on the other hand, is exactly what an empty history
    // wants.
    expect(screen.getByRole('button', { name: /restore seeded history/i })).toBeEnabled();
  });

  it('drops a count from the customer who was selected before', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^clear history$/i }),
    );

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    await userEvent.selectOptions(
      screen.getByLabelText(/customer/i),
      'user-2',
    );

    // "Cleared 9 payments" about the previous account would be read as
    // this one's.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('puts the cancel BEFORE the destructive button, in reading order', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));

    const labels = within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .map((button) => button.textContent);

    // A thumb already moving toward the dialog must not land on the
    // irreversible one.
    expect(labels).toEqual(['Keep it', 'Clear history']);
  });

  it('offers neither control before a customer is chosen', async () => {
    customers.mockResolvedValue([]);

    render(<AdminDemoPage />);

    await waitFor(() => expect(customers).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /clear history/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /restore seeded history/i }),
    ).not.toBeInTheDocument();
  });
});

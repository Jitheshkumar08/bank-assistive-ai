import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoPaymentDialog } from './DemoPaymentDialog';
import { localNoonIso, toDateInputValue } from '@/lib/simulatedDate';
import type { DemoPayeeView, DemoPaymentRow } from '@/types/adminDemo';

/**
 * The form for one demonstration record.
 *
 * Money is the thing worth being fussy about: amounts are entered in
 * whole rupees and leave as integer paise, so no decimal ever gets
 * parsed into money. The other checks here guard the two invariants
 * that live outside this component -- a payee name reaches the speech
 * synthesiser, and an account is only ever four digits.
 */

const RAHUL: DemoPayeeView = {
  id: 'payee-rahul',
  displayName: 'Rahul',
  fullName: 'Rahul Shetty',
  accountLast4: '4821',
  trust: 'DEMO_SEEDED',
};

const PRIYA: DemoPayeeView = {
  id: 'payee-priya',
  displayName: 'Priya',
  fullName: null,
  accountLast4: '7310',
  trust: 'DEMO_SEEDED',
};

const EXISTING: DemoPaymentRow = {
  id: 'row-1',
  payee: RAHUL,
  amountMinor: 500_000,
  currency: 'INR',
  status: 'COMPLETED',
  occurredAt: localNoonIso(2026, 10, 16),
  createdAt: localNoonIso(2026, 10, 16),
  countsTowardSuggestions: true,
  ignoredReason: null,
};

const DEFAULT_DATE = localNoonIso(2026, 11, 15);

function setup(overrides: Partial<Parameters<typeof DemoPaymentDialog>[0]> = {}) {
  const onCreate = vi.fn();
  const onUpdate = vi.fn();
  const onCancel = vi.fn();

  render(
    <DemoPaymentDialog
      payees={[RAHUL, PRIYA]}
      editing={null}
      defaultOccurredAt={DEFAULT_DATE}
      maxAmountMinor={1_000_000}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onCancel={onCancel}
      {...overrides}
    />,
  );

  return { onCreate, onUpdate, onCancel };
}

const amountField = () => screen.getByLabelText(/amount in rupees/i);

beforeEach(() => vi.clearAllMocks());

describe('DemoPaymentDialog, adding', () => {
  it('says plainly that it does not move money', () => {
    setup();

    expect(screen.getByText(/does not move money/i)).toBeInTheDocument();
  });

  it('defaults the date to the simulated one', () => {
    setup();

    expect(screen.getByLabelText(/^date/i)).toHaveValue(toDateInputValue(DEFAULT_DATE));
  });

  it('sends whole rupees as integer paise', async () => {
    const { onCreate } = setup();

    await userEvent.type(amountField(), '2500');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 250_000, status: 'COMPLETED' }),
    );
  });

  it('never sends a currency field', async () => {
    const { onCreate } = setup();

    await userEvent.type(amountField(), '2500');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(Object.keys(onCreate.mock.calls[0][0])).not.toContain('currency');
  });

  it('refuses a decimal amount rather than rounding it silently', async () => {
    const { onCreate } = setup();

    await userEvent.type(amountField(), '49.99');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/whole number of rupees/i);
  });

  it('refuses an amount above the ceiling, and names it', async () => {
    const { onCreate } = setup();

    await userEvent.type(amountField(), '10001');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/10,000/);
    expect(screen.getByRole('alert')).toHaveTextContent(/review screen/i);
  });

  it('refuses less than a rupee', async () => {
    const { onCreate } = setup();

    await userEvent.type(amountField(), '0');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/at least ₹1/i);
  });

  it('sends the chosen existing payee by id alone', async () => {
    const { onCreate } = setup();

    await userEvent.selectOptions(screen.getByLabelText(/payee/i), 'payee-priya');
    await userEvent.type(amountField(), '1250');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payeeId: 'payee-priya' }),
    );
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('newPayee');
  });

  it('collects a new payee only when asked for one', async () => {
    const { onCreate } = setup();

    expect(screen.queryByLabelText(/^name/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/payee/i), '__new__');
    await userEvent.type(screen.getByLabelText(/^name/i), 'Lakshmi');
    await userEvent.type(screen.getByLabelText(/last 4 digits/i), '5678');
    await userEvent.type(amountField(), '3000');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        newPayee: { displayName: 'Lakshmi', accountLast4: '5678' },
      }),
    );
  });

  it('refuses a payee name with a digit in it', async () => {
    // Such a name would reach the SPOKEN line, where no digit may appear.
    const { onCreate } = setup();

    await userEvent.selectOptions(screen.getByLabelText(/payee/i), '__new__');
    await userEvent.type(screen.getByLabelText(/^name/i), 'Rahul 2');
    await userEvent.type(screen.getByLabelText(/last 4 digits/i), '5678');
    await userEvent.type(amountField(), '3000');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/letters only/i);
  });

  it('insists on exactly four digits of account', async () => {
    const { onCreate } = setup();

    await userEvent.selectOptions(screen.getByLabelText(/payee/i), '__new__');
    await userEvent.type(screen.getByLabelText(/^name/i), 'Lakshmi');
    await userEvent.type(screen.getByLabelText(/last 4 digits/i), '567');
    await userEvent.type(amountField(), '3000');
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/last four digits/i);
  });

  it('explains what each status does to the detectors', () => {
    setup();

    expect(screen.getByText(/counts towards suggestions/i)).toBeInTheDocument();
    expect(screen.getAllByText(/ignored by both detectors/i)).toHaveLength(2);
  });

  it('can record a failed payment', async () => {
    const { onCreate } = setup();

    await userEvent.type(amountField(), '5000');
    await userEvent.click(screen.getByRole('radio', { name: /failed/i }));
    await userEvent.click(screen.getByRole('button', { name: /add payment/i }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });
});

describe('DemoPaymentDialog, editing', () => {
  it('opens with the record\'s own values', () => {
    setup({ editing: EXISTING });

    expect(screen.getByRole('heading', { name: /edit demonstration payment/i })).toBeInTheDocument();
    expect(amountField()).toHaveValue('5000');
    expect(screen.getByLabelText(/^date/i)).toHaveValue(toDateInputValue(EXISTING.occurredAt));
    expect(screen.getByRole('radio', { name: /completed/i })).toBeChecked();
  });

  it('sends ONLY what changed', async () => {
    const { onUpdate } = setup({ editing: EXISTING });

    await userEvent.click(screen.getByRole('radio', { name: /pending/i }));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // Not the amount, not the date, not the payee.
    expect(onUpdate).toHaveBeenCalledWith({ status: 'PENDING' });
  });

  it('refuses to send an unchanged form', async () => {
    const { onUpdate } = setup({ editing: EXISTING });

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/nothing has been changed/i);
  });

  it('offers no way to invent a payee while editing', () => {
    setup({ editing: EXISTING });

    expect(screen.queryByRole('option', { name: /new payee/i })).not.toBeInTheDocument();
  });

  it('shows the server\'s own refusal rather than a cheerful guess', () => {
    setup({ editing: EXISTING, error: 'That payee is not a demonstration beneficiary.' });

    expect(screen.getByRole('alert')).toHaveTextContent(/not a demonstration beneficiary/i);
  });

  it('rests its controls while a write is in flight', () => {
    setup({ editing: EXISTING, busy: true });

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    const { onCancel } = setup({ editing: EXISTING });

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalled();
  });
});

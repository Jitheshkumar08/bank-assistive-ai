import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SuggestionCard } from './SuggestionCard';
import { suggestionCopy } from '@/lib/suggestionCopy';
import type { Suggestion } from '@/types/suggestions';

/**
 * One remembered payment, on screen.
 *
 * The card is where figures are allowed to appear, because only the
 * person holding the phone can read them. What it must never do is
 * present a seeded demonstration record as something the bank
 * confirmed.
 */

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'offer-1',
    type: 'LAST_PAYMENT',
    kind: 'PAYMENT_GUIDANCE',
    provenance: 'DEMO_HISTORY',
    isBankVerified: false,
    payee: {
      displayName: 'Rahul',
      fullName: 'Rahul Shetty',
      accountLast4: '4821',
      trust: 'DEMO_SEEDED',
    },
    amountMinor: 500_000,
    currency: 'INR',
    lastOccurredAt: '2026-11-11T06:30:00.000Z',
    occurrenceCount: null,
    usualDayOfMonth: null,
    ...overrides,
  };
}

function renderCard(item: Suggestion, language = 'en') {
  const onContinue = vi.fn();
  const onDecline = vi.fn();

  render(
    <SuggestionCard
      suggestion={item}
      language={language}
      onContinue={onContinue}
      onDecline={onDecline}
    />,
  );

  return { onContinue, onDecline };
}

describe('SuggestionCard', () => {
  it('shows who was paid, how much, and the masked account', () => {
    renderCard(suggestion());

    expect(screen.getByText('Payment to Rahul')).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
    expect(screen.getByText(/4821/)).toBeInTheDocument();
  });

  it('describes a recurring payment by the date it usually falls on', () => {
    renderCard(suggestion({ type: 'RECURRING_TODAY', occurrenceCount: 4, usualDayOfMonth: 16 }));

    expect(screen.getByText('Usually paid to Rahul around the 16th')).toBeInTheDocument();
  });

  it('labels a demonstration record, and never calls it verified', () => {
    renderCard(suggestion());

    expect(screen.getByText(/demo history/i)).toBeInTheDocument();
    expect(screen.getByText(/not bank statements/i)).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('drops the demonstration label once a record is genuinely bank verified', () => {
    renderCard(suggestion({ provenance: 'BANK_VERIFIED', isBankVerified: true }));

    expect(screen.queryByText(/demo history/i)).not.toBeInTheDocument();
  });

  it('never shows more of an account than its last four digits', () => {
    renderCard(suggestion());

    // 4821 is fine. Anything longer is not a mask.
    expect(document.body.textContent).not.toMatch(/\d{5,}/);
  });

  it('offers to continue, and to decline', async () => {
    const { onContinue, onDecline } = renderCard(suggestion());

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('cannot be tapped twice while its answer is in flight', () => {
    render(
      <SuggestionCard
        suggestion={suggestion()}
        language="en"
        busy
        onContinue={vi.fn()}
        onDecline={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
  });

  it('speaks the reader\'s language on the card as well as aloud', () => {
    renderCard(suggestion(), 'kn');

    const kannada = suggestionCopy('kn');

    expect(screen.getByText(kannada.payeeLine('Rahul'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: kannada.continueLabel })).toBeInTheDocument();
  });
});

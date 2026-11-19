import { detectLastPayment } from '../../src/suggestions/detectors/last-payment.detector';
import type { PaymentHistoryItem } from '../../src/suggestions/detectors/types';

/**
 * The last-payment card.
 *
 * No database, no clock: the history and "now" are both arguments, so
 * every rule can be pinned to an exact day.
 */

const NOW = new Date('2026-11-16T12:00:00.000Z');

function payment(
  daysAgo: number,
  overrides: Partial<PaymentHistoryItem> = {},
): PaymentHistoryItem {
  return {
    payeeId: 'payee-rahul',
    amountMinor: 500_000,
    occurredAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    provenance: 'DEMO_HISTORY',
    ...overrides,
  };
}

describe('detectLastPayment', () => {
  it('offers the most recent payment', () => {
    const result = detectLastPayment(
      [payment(30), payment(5, { payeeId: 'payee-priya', amountMinor: 125_000 }), payment(60)],
      NOW,
    );

    expect(result).toMatchObject({
      type: 'LAST_PAYMENT',
      payeeId: 'payee-priya',
      amountMinor: 125_000,
    });
  });

  it('says nothing when there is no payment history at all', () => {
    expect(detectLastPayment([], NOW)).toBeNull();
  });

  it('stays silent about a payment made in the last day', () => {
    // Someone who paid this morning does not need to be invited to pay
    // again. This is where a duplicate payment would start.
    expect(detectLastPayment([payment(0.25)], NOW)).toBeNull();
  });

  it('offers a payment made just over a day ago', () => {
    expect(detectLastPayment([payment(1.1)], NOW)).not.toBeNull();
  });

  it('stays silent once the payment is older than sixty days', () => {
    expect(detectLastPayment([payment(61)], NOW)).toBeNull();
    expect(detectLastPayment([payment(59)], NOW)).not.toBeNull();
  });

  it('ignores a date in the future', () => {
    // A clock-skewed or badly seeded row must not become "your last
    // payment", and must not hide the real one either.
    const result = detectLastPayment([payment(-3, { payeeId: 'payee-future' }), payment(4)], NOW);

    expect(result).toMatchObject({ payeeId: 'payee-rahul' });
  });

  it('carries the provenance through, so demo history can be labelled', () => {
    const result = detectLastPayment([payment(4, { provenance: 'ASSISTED_ACTIVITY' })], NOW);

    expect(result?.provenance).toBe('ASSISTED_ACTIVITY');
  });

  it('takes the amount from the newest payment, not the biggest', () => {
    const result = detectLastPayment(
      [payment(20, { amountMinor: 900_000 }), payment(3, { amountMinor: 100_000 })],
      NOW,
    );

    expect(result?.amountMinor).toBe(100_000);
  });
});

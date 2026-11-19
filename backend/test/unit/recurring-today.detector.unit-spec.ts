import { detectRecurringToday } from '../../src/suggestions/detectors/recurring-today.detector';
import type { PaymentHistoryItem } from '../../src/suggestions/detectors/types';

/**
 * The "you usually pay around this date" card.
 *
 * Local dates throughout, because the detector reads a calendar the way
 * a customer does -- the 1st is the 1st wherever the server is.
 *
 * The silences are the point of this suite. A card that fires when the
 * bill is already paid, or when three payments in one busy week look
 * like a habit, is worse than no card.
 */

/** Noon on a local calendar day. */
function on(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

const NOW = on(2026, 11, 16);

function payment(
  occurredAt: Date,
  overrides: Partial<PaymentHistoryItem> = {},
): PaymentHistoryItem {
  return {
    payeeId: 'payee-rahul',
    amountMinor: 500_000,
    occurredAt,
    provenance: 'DEMO_HISTORY',
    ...overrides,
  };
}

/** The same day of the month, for each of the given months of 2026. */
function monthly(days: readonly [number, number][], overrides = {}) {
  return days.map(([month, day]) => payment(on(2026, month, day), overrides));
}

describe('detectRecurringToday', () => {
  it('offers a genuine monthly pattern that falls on today', () => {
    const result = detectRecurringToday(
      monthly([
        [6, 16],
        [7, 16],
        [8, 15],
        [9, 17],
        [10, 16],
      ]),
      NOW,
    );

    expect(result).toMatchObject({
      type: 'RECURRING_TODAY',
      payeeId: 'payee-rahul',
      occurrenceCount: 5,
      usualDayOfMonth: 16,
    });
  });

  it('says nothing when this cycle has already been paid', () => {
    // The rule that stops the assistant inviting someone to pay their
    // rent a second time.
    const history = [
      ...monthly([
        [6, 16],
        [7, 16],
        [8, 16],
        [9, 16],
        [10, 16],
      ]),
      payment(on(2026, 11, 14)),
    ];

    expect(detectRecurringToday(history, NOW)).toBeNull();
  });

  it('does not mistake three payments in one week for a monthly habit', () => {
    const busyWeek = [
      payment(on(2026, 11, 14)),
      payment(on(2026, 11, 15)),
      payment(on(2026, 11, 16)),
    ];

    expect(detectRecurringToday(busyWeek, NOW)).toBeNull();
  });

  it('needs three different months, not three payments', () => {
    const twoMonths = [
      payment(on(2026, 9, 16)),
      payment(on(2026, 10, 16)),
      payment(on(2026, 10, 17)),
    ];

    expect(detectRecurringToday(twoMonths, NOW)).toBeNull();
  });

  it('reads a month-end habit from the end of the month, so February cannot break it', () => {
    // 30th, 31st, 31st, then today is the 28th of February: nonsense
    // counted from the 1st, exact counted from the last day.
    const monthEnd = [
      payment(on(2026, 11, 30)),
      payment(on(2026, 12, 31)),
      payment(on(2027, 1, 31)),
    ];

    const result = detectRecurringToday(monthEnd, on(2027, 2, 28));

    expect(result).toMatchObject({ type: 'RECURRING_TODAY', usualDayOfMonth: 28 });
  });

  it('stays silent on any other day of the month', () => {
    const pattern = monthly([
      [6, 1],
      [7, 1],
      [8, 1],
      [9, 1],
      [10, 1],
    ]);

    // A habit on the 1st, asked about on the 16th.
    expect(detectRecurringToday(pattern, NOW)).toBeNull();
  });

  it('tolerates a couple of days either side of the usual date', () => {
    const pattern = monthly([
      [6, 14],
      [7, 14],
      [8, 15],
    ]);

    // Usual day 14, today the 16th: within tolerance.
    expect(detectRecurringToday(pattern, NOW)).not.toBeNull();
  });

  it('rejects dates too scattered to be a pattern', () => {
    const scattered = [
      payment(on(2026, 6, 10)),
      payment(on(2026, 7, 16)),
      payment(on(2026, 8, 22)),
    ];

    expect(detectRecurringToday(scattered, NOW)).toBeNull();
  });

  it('ignores payments older than the lookback window', () => {
    const stale = [
      payment(on(2026, 2, 16)),
      payment(on(2026, 3, 16)),
      payment(on(2026, 4, 16)),
      payment(on(2026, 10, 16)),
    ];

    // Only one of those is inside six months.
    expect(detectRecurringToday(stale, NOW)).toBeNull();
  });

  it('prefers the stronger habit when two payees both qualify', () => {
    const history = [
      ...monthly([
        [6, 16],
        [7, 16],
        [8, 16],
        [9, 16],
        [10, 16],
      ]),
      ...monthly(
        [
          [8, 16],
          [9, 16],
          [10, 16],
        ],
        { payeeId: 'payee-priya' },
      ),
    ];

    expect(detectRecurringToday(history, NOW)?.payeeId).toBe('payee-rahul');
  });

  it('takes the amount and provenance from the most recent occurrence', () => {
    const history = [
      payment(on(2026, 8, 16), { amountMinor: 400_000 }),
      payment(on(2026, 9, 16), { amountMinor: 400_000 }),
      payment(on(2026, 10, 16), { amountMinor: 650_000, provenance: 'ASSISTED_ACTIVITY' }),
    ];

    expect(detectRecurringToday(history, NOW)).toMatchObject({
      amountMinor: 650_000,
      provenance: 'ASSISTED_ACTIVITY',
    });
  });

  it('counts one representative per month, so a double payment cannot skew the date', () => {
    const history = [
      payment(on(2026, 8, 16)),
      payment(on(2026, 8, 28)),
      payment(on(2026, 9, 16)),
      payment(on(2026, 10, 16)),
    ];

    expect(detectRecurringToday(history, NOW)).toMatchObject({
      occurrenceCount: 3,
      usualDayOfMonth: 16,
    });
  });
});

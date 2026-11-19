import {
  analyseLastPayment,
  detectLastPayment,
} from '../../src/suggestions/detectors/last-payment.detector';
import {
  analyseRecurringToday,
  detectRecurringToday,
} from '../../src/suggestions/detectors/recurring-today.detector';
import {
  LAST_PAYMENT_MAX_AGE_DAYS,
  LAST_PAYMENT_MIN_AGE_HOURS,
  RECURRING_CLUSTER_TOLERANCE_DAYS,
  RECURRING_LOOKBACK_DAYS,
  RECURRING_MIN_OCCURRENCES,
  RECURRING_TODAY_TOLERANCE_DAYS,
  type PaymentHistoryItem,
} from '../../src/suggestions/detectors/types';

/**
 * The reasoning behind each verdict.
 *
 * Two things are being pinned down here, and the first matters more
 * than the second.
 *
 *   ONE IMPLEMENTATION. `detect*` must be exactly `analyse*().candidate`
 *   for every shape of history, because the testing dashboard explains
 *   decisions using the analysis while customers receive the detection.
 *   The moment those two can disagree, the dashboard starts lying.
 *
 *   Every exit point reports WHY. A dashboard that can only say "no
 *   card" is no more use than the welcome screen itself.
 */

/** Noon on a local calendar day, as the detectors read calendars. */
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

function monthly(
  days: readonly [number, number][],
  overrides: Partial<PaymentHistoryItem> = {},
): PaymentHistoryItem[] {
  return days.map(([month, day]) => payment(on(2026, month, day), overrides));
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/** A monthly habit on the 16th: the shape that should fire on NOW. */
const HABIT = monthly([
  [6, 16],
  [7, 16],
  [8, 16],
  [9, 16],
  [10, 16],
]);

describe('the detectors and their analyses are one implementation', () => {
  // Every shape the rules distinguish, including the degenerate ones.
  const histories: Record<string, PaymentHistoryItem[]> = {
    'empty': [],
    'a single fresh payment': [payment(hoursAgo(2))],
    'a single usable payment': [payment(daysAgo(4))],
    'a single stale payment': [payment(daysAgo(LAST_PAYMENT_MAX_AGE_DAYS + 1))],
    'a monthly habit on today': HABIT,
    'a habit already paid this month': [...HABIT, payment(on(2026, 11, 2))],
    'two months only': monthly([
      [9, 16],
      [10, 16],
    ]),
    'three payments in one week': monthly([
      [8, 8],
      [8, 10],
      [8, 12],
    ]),
    'scattered dates': monthly([
      [8, 3],
      [9, 17],
      [10, 27],
    ]),
    'a habit on the wrong day': monthly([
      [6, 2],
      [7, 2],
      [8, 2],
    ]),
    'only future payments': [payment(on(2027, 1, 16))],
    'two competing habits': [
      ...HABIT,
      ...monthly([
        [8, 15],
        [9, 15],
        [10, 15],
      ], { payeeId: 'payee-priya', amountMinor: 125_000 }),
    ],
  };

  for (const [name, history] of Object.entries(histories)) {
    it(`agrees on ${name}`, () => {
      // Deliberately toEqual, not a null check: the whole candidate,
      // field for field, from both paths.
      expect(detectRecurringToday(history, NOW)).toEqual(
        analyseRecurringToday(history, NOW).candidate,
      );

      expect(detectLastPayment(history, NOW)).toEqual(
        analyseLastPayment(history, NOW).candidate,
      );
    });
  }
});

describe('analyseRecurringToday explains itself', () => {
  it('reports the thresholds it applied, not a second copy of them', () => {
    expect(analyseRecurringToday(HABIT, NOW).thresholds).toEqual({
      lookbackDays: RECURRING_LOOKBACK_DAYS,
      minOccurrences: RECURRING_MIN_OCCURRENCES,
      clusterToleranceDays: RECURRING_CLUSTER_TOLERANCE_DAYS,
      todayToleranceDays: RECURRING_TODAY_TOLERANCE_DAYS,
    });
  });

  it('says there was nothing to go on when the window is empty', () => {
    const analysis = analyseRecurringToday([], NOW);

    expect(analysis.verdict).toBe('NO_HISTORY_IN_WINDOW');
    expect(analysis.findings).toEqual([]);
    expect(analysis.candidate).toBeNull();
  });

  it('treats history older than the window as no history at all', () => {
    const stale = monthly([
      [1, 16],
      [2, 16],
      [3, 16],
    ]);

    const analysis = analyseRecurringToday(stale, NOW);

    expect(analysis.verdict).toBe('NO_HISTORY_IN_WINDOW');
    expect(analysis.windowStart.getTime()).toBe(
      NOW.getTime() - RECURRING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it('names the matched pattern, with the numbers behind it', () => {
    const analysis = analyseRecurringToday(HABIT, NOW);

    expect(analysis.verdict).toBe('MATCHED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0]).toMatchObject({
      payeeId: 'payee-rahul',
      verdict: 'MATCHED',
      paymentCount: 5,
      distinctMonths: 5,
      spread: 0,
      modal: 16,
      fromEnd: false,
      todayValue: 16,
    });
    expect(analysis.findings[0].representativeDates).toHaveLength(5);
  });

  it('says the bill is already settled rather than staying silent', () => {
    const analysis = analyseRecurringToday([...HABIT, payment(on(2026, 11, 2))], NOW);

    expect(analysis.verdict).toBe('NO_PATTERN_MATCHED_TODAY');
    expect(analysis.candidate).toBeNull();
    expect(analysis.findings[0]).toMatchObject({
      verdict: 'ALREADY_PAID_THIS_MONTH',
      paymentCount: 6,
      distinctMonths: 6,
      // Not measured: the loop stops before judging the pattern.
      spread: null,
      modal: null,
      todayValue: null,
    });
  });

  it('counts the months when there are too few of them', () => {
    const analysis = analyseRecurringToday(
      monthly([
        [9, 16],
        [10, 16],
      ]),
      NOW,
    );

    expect(analysis.findings[0]).toMatchObject({
      verdict: 'DISTINCT_MONTHS_TOO_FEW',
      distinctMonths: 2,
    });
  });

  it('does not mistake three payments in one week for a habit', () => {
    const analysis = analyseRecurringToday(
      monthly([
        [8, 8],
        [8, 10],
        [8, 12],
      ]),
      NOW,
    );

    expect(analysis.findings[0]).toMatchObject({
      verdict: 'DISTINCT_MONTHS_TOO_FEW',
      paymentCount: 3,
      distinctMonths: 1,
    });
  });

  it('reports the spread when the dates refuse to cluster', () => {
    const analysis = analyseRecurringToday(
      monthly([
        [8, 3],
        [9, 17],
        [10, 27],
      ]),
      NOW,
    );

    const finding = analysis.findings[0];

    expect(finding.verdict).toBe('CLUSTER_TOO_WIDE');
    expect(finding.spread).toBeGreaterThan(RECURRING_CLUSTER_TOLERANCE_DAYS);
    expect(finding.representativeDates).toHaveLength(3);
  });

  it('reports how far today is from the usual day', () => {
    const analysis = analyseRecurringToday(
      monthly([
        [6, 2],
        [7, 2],
        [8, 2],
      ]),
      NOW,
    );

    const finding = analysis.findings[0];

    expect(finding.verdict).toBe('TODAY_OUTSIDE_WINDOW');
    expect(finding.modal).toBe(2);
    expect(finding.todayValue).toBe(16);
    expect(Math.abs(finding.todayValue! - finding.modal!)).toBeGreaterThan(
      RECURRING_TODAY_TOLERANCE_DAYS,
    );
  });

  it('keeps a finding for every payee, not only the winner', () => {
    const analysis = analyseRecurringToday(
      [
        ...HABIT,
        ...monthly(
          [
            [8, 15],
            [9, 15],
            [10, 15],
          ],
          { payeeId: 'payee-priya', amountMinor: 125_000 },
        ),
      ],
      NOW,
    );

    expect(analysis.verdict).toBe('MATCHED');
    expect(analysis.findings).toHaveLength(2);
    expect(analysis.findings.map((finding) => finding.payeeId).sort()).toEqual([
      'payee-priya',
      'payee-rahul',
    ]);

    // Five months beats three, and only one is ever offered.
    expect(analysis.candidate?.payeeId).toBe('payee-rahul');
    expect(analysis.findings.filter((finding) => finding.verdict === 'MATCHED')).toHaveLength(2);
  });

  it('reads a month-end habit from the end of the month', () => {
    const monthEnd = [
      payment(on(2026, 11, 30)),
      payment(on(2026, 12, 31)),
      payment(on(2027, 1, 31)),
    ];

    const analysis = analyseRecurringToday(monthEnd, on(2027, 2, 28));

    expect(analysis.verdict).toBe('MATCHED');
    expect(analysis.findings[0]).toMatchObject({ fromEnd: true, spread: 0, todayValue: 0 });
    expect(analysis.candidate?.usualDayOfMonth).toBe(28);
  });
});

describe('analyseLastPayment explains itself', () => {
  it('reports the thresholds it applied', () => {
    expect(analyseLastPayment([payment(daysAgo(4))], NOW).thresholds).toEqual({
      maxAgeDays: LAST_PAYMENT_MAX_AGE_DAYS,
      minAgeHours: LAST_PAYMENT_MIN_AGE_HOURS,
    });
  });

  it('distinguishes no history from a refused payment', () => {
    const analysis = analyseLastPayment([], NOW);

    expect(analysis.verdict).toBe('NO_PAST_PAYMENTS');
    expect(analysis.latestOccurredAt).toBeNull();
    expect(analysis.latestPayeeId).toBeNull();
    expect(analysis.ageHours).toBeNull();
  });

  it('counts only past payments as history', () => {
    const analysis = analyseLastPayment([payment(on(2027, 1, 16))], NOW);

    expect(analysis.verdict).toBe('NO_PAST_PAYMENTS');
  });

  it('says a payment is too recent, and how recent', () => {
    const analysis = analyseLastPayment([payment(hoursAgo(3))], NOW);

    expect(analysis.verdict).toBe('TOO_RECENT');
    expect(analysis.candidate).toBeNull();
    expect(analysis.ageHours).toBeCloseTo(3);
    // The payment is still named: this is the explanation an admin needs
    // when a card they expected does not appear.
    expect(analysis.latestPayeeId).toBe('payee-rahul');
  });

  it('says a payment is too old, and how old', () => {
    const analysis = analyseLastPayment(
      [payment(daysAgo(LAST_PAYMENT_MAX_AGE_DAYS + 1))],
      NOW,
    );

    expect(analysis.verdict).toBe('TOO_OLD');
    expect(analysis.candidate).toBeNull();
    expect(analysis.ageHours).toBeCloseTo((LAST_PAYMENT_MAX_AGE_DAYS + 1) * 24);
  });

  it('matches the most recent usable payment', () => {
    const analysis = analyseLastPayment(
      [payment(daysAgo(30)), payment(daysAgo(4), { payeeId: 'payee-priya' })],
      NOW,
    );

    expect(analysis.verdict).toBe('MATCHED');
    expect(analysis.candidate?.payeeId).toBe('payee-priya');
    expect(analysis.latestPayeeId).toBe('payee-priya');
    expect(analysis.ageHours).toBeCloseTo(96);
  });
});

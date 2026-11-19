import type { DemoPaymentStatus } from '@prisma/client';

/**
 * The seeded demonstration payment history, in one place.
 *
 * This is NOT customer data and NOT a bank record. It exists so the
 * remembered-payment suggestions have something to find on a developer
 * machine, and it is only ever read when DEMO_HISTORY_ENABLED is on.
 *
 * It lives here, rather than inside the seed script, because two
 * callers need the same definition: `prisma/seed.ts` when a database is
 * first populated, and the testing dashboard's restore action when an
 * afternoon of editing needs putting back. Two copies would drift, and
 * the one that drifted would be the one someone demonstrates with.
 *
 * It is shaped to exercise all three cases the detectors must handle:
 *
 *   Rahul  a genuine monthly pattern on today's day-of-month, with the
 *          CURRENT month deliberately missing -- that is the whole
 *          premise of the recurring card: the payment is due and has
 *          not been made yet
 *   Priya  a single recent payment, so the last-payment card has a
 *          different payee and the two cards cannot collapse into one
 *   Vinay  three payments inside one week, months ago, which must NOT
 *          be mistaken for a monthly habit
 *
 * Every date is computed from a `now` the caller passes, so the fixture
 * is always "a habit that is due today" rather than a set of dates that
 * rot as the calendar moves. Passing `now` explicitly also makes the
 * shape assertable in a unit test without a clock stub.
 */

export interface DemoFixturePayee {
  /** How payments below refer to this payee. Never stored. */
  key: string;
  displayName: string;
  fullName: string | null;
  /** Exactly four digits: there is no column for more. */
  accountLast4: string;
}

export interface DemoFixturePayment {
  payeeKey: string;
  /** Minor units (paise), whole rupees only. */
  amountMinor: number;
  occurredAt: Date;
  status: DemoPaymentStatus;
}

export interface DemoFixture {
  payees: DemoFixturePayee[];
  payments: DemoFixturePayment[];
}

/**
 * The three beneficiaries, masked as every other screen masks them.
 *
 * Written here as the only place they are defined, so a name the team
 * recognises from a demonstration is traceable to one line of source.
 */
export const DEMO_FIXTURE_PAYEES: DemoFixturePayee[] = [
  { key: 'rahul', displayName: 'Rahul', fullName: 'Rahul Shetty', accountLast4: '4821' },
  { key: 'priya', displayName: 'Priya', fullName: 'Priya Nayak', accountLast4: '7310' },
  { key: 'vinay', displayName: 'Vinay', fullName: 'Vinay Rao', accountLast4: '9052' },
];

/**
 * Noon, so a date can never slide into the previous day by timezone.
 *
 * The day is clamped at BOTH ends. The upper bound is the obvious one --
 * the 31st does not exist in February. The lower bound matters just as
 * much and is easy to miss: the jitter below subtracts a day, and
 * `setDate(0)` means "the last day of the previous month", so a fixture
 * built on the 1st would scatter its monthly pattern across day 1 and
 * day 31 of different months. The cluster would then be wider than the
 * detector's tolerance and the recurring card -- the whole point of the
 * fixture -- would silently not appear, on exactly two days a month.
 */
function monthsAgo(now: Date, months: number, dayOfMonth: number): Date {
  const date = new Date(now.getFullYear(), now.getMonth() - months, 1, 12, 0, 0, 0);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(Math.max(dayOfMonth, 1), lastDay));
  return date;
}

function daysAgo(now: Date, days: number): Date {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date;
}

/**
 * A real habit is never exactly on the same date every month, so the
 * dates jitter by a day. The detector tolerates that; a detector that
 * only matched an exact date would never fire in practice.
 */
const JITTER = [0, 1, -1, 0, 1, -1];

/** How many rows the fixture holds, without building it. */
export const DEMO_FIXTURE_PAYMENT_COUNT = 9;

export function buildDemoFixture(now: Date = new Date()): DemoFixture {
  const today = now.getDate();

  const payments: DemoFixturePayment[] = [
    // The monthly pattern: five months back to one month back.
    ...[1, 2, 3, 4, 5].map((months) => ({
      payeeKey: 'rahul',
      amountMinor: 500_000,
      occurredAt: monthsAgo(now, months, today + JITTER[months]),
      status: 'COMPLETED' as DemoPaymentStatus,
    })),

    // The most recent payment, to someone else.
    {
      payeeKey: 'priya',
      amountMinor: 125_000,
      occurredAt: daysAgo(now, 5),
      status: 'COMPLETED' as DemoPaymentStatus,
    },

    // Three payments in one week, three months ago: frequent, but not
    // monthly, and not around today.
    {
      payeeKey: 'vinay',
      amountMinor: 30_000,
      occurredAt: monthsAgo(now, 3, 8),
      status: 'COMPLETED' as DemoPaymentStatus,
    },
    {
      payeeKey: 'vinay',
      amountMinor: 45_000,
      occurredAt: monthsAgo(now, 3, 10),
      status: 'COMPLETED' as DemoPaymentStatus,
    },
    {
      payeeKey: 'vinay',
      amountMinor: 20_000,
      occurredAt: monthsAgo(now, 3, 12),
      status: 'COMPLETED' as DemoPaymentStatus,
    },
  ];

  return { payees: DEMO_FIXTURE_PAYEES.map((payee) => ({ ...payee })), payments };
}

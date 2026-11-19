import {
  DEMO_FIXTURE_PAYEES,
  DEMO_FIXTURE_PAYMENT_COUNT,
  buildDemoFixture,
} from '../../src/admin-demo/demo-fixture';

/**
 * The seeded demonstration fixture.
 *
 * This is the one definition `prisma/seed.ts` writes on a fresh machine
 * and the testing dashboard's restore action writes back afterwards, so
 * its SHAPE is what makes a demonstration work or not. Each property
 * below corresponds to something the detectors must conclude:
 *
 *   a tight monthly cluster on today's day-of-month, with the current
 *   month missing   -> the recurring card has something to offer
 *   one recent payment to a DIFFERENT payee
 *                   -> the two cards cannot collapse into one
 *   a burst inside one week, months ago
 *                   -> frequent is not the same as monthly
 *
 * `now` is passed explicitly throughout, so these are assertions rather
 * than observations about the day the suite happened to run.
 */

/** Mid-month, where nothing is clamped: the ordinary case. */
const MID_MONTH = new Date(2026, 5, 17, 9, 30, 0, 0);

function group(now: Date) {
  const fixture = buildDemoFixture(now);
  const byKey = new Map<string, typeof fixture.payments>();

  for (const payment of fixture.payments) {
    const list = byKey.get(payment.payeeKey) ?? [];
    list.push(payment);
    byKey.set(payment.payeeKey, list);
  }

  return { fixture, byKey };
}

describe('the demonstration fixture', () => {
  it('defines three beneficiaries and nine payments', () => {
    const fixture = buildDemoFixture(MID_MONTH);

    expect(fixture.payees).toHaveLength(3);
    expect(fixture.payments).toHaveLength(9);
    // The advertised count and the built one cannot drift apart.
    expect(fixture.payments).toHaveLength(DEMO_FIXTURE_PAYMENT_COUNT);
  });

  it('holds no more of an account than its last four digits', () => {
    for (const payee of DEMO_FIXTURE_PAYEES) {
      expect(payee.accountLast4).toMatch(/^\d{4}$/);
    }
  });

  it('attaches every payment to a payee it actually defines', () => {
    const { fixture } = group(MID_MONTH);
    const keys = new Set(fixture.payees.map((payee) => payee.key));

    for (const payment of fixture.payments) {
      expect(keys.has(payment.payeeKey)).toBe(true);
    }
  });

  it('is COMPLETED throughout, because only COMPLETED is evidence', () => {
    const fixture = buildDemoFixture(MID_MONTH);

    for (const payment of fixture.payments) {
      expect(payment.status).toBe('COMPLETED');
    }
  });

  it('uses whole rupees inside the limit the review screen enforces', () => {
    const fixture = buildDemoFixture(MID_MONTH);

    for (const payment of fixture.payments) {
      // Not tidiness: amounts are rendered with no decimal places, so a
      // fractional rupee would make every screen disagree with the row.
      expect(payment.amountMinor % 100).toBe(0);
      expect(payment.amountMinor).toBeGreaterThanOrEqual(100);
      expect(payment.amountMinor).toBeLessThanOrEqual(1_000_000);
    }
  });

  it('dates everything at local noon, in the past', () => {
    const fixture = buildDemoFixture(MID_MONTH);

    for (const payment of fixture.payments) {
      expect(payment.occurredAt.getHours()).toBe(12);
      expect(payment.occurredAt.getMinutes()).toBe(0);
      expect(payment.occurredAt.getTime()).toBeLessThan(MID_MONTH.getTime());
    }
  });

  it('gives Rahul a monthly habit across five distinct months', () => {
    const { byKey } = group(MID_MONTH);
    const rahul = byKey.get('rahul')!;

    expect(rahul).toHaveLength(5);

    const months = new Set(
      rahul.map((p) => `${p.occurredAt.getFullYear()}-${p.occurredAt.getMonth()}`),
    );

    // Five months, not five payments in one -- distinct months are what
    // the recurring detector counts.
    expect(months.size).toBe(5);
  });

  it('LEAVES THE CURRENT MONTH EMPTY, which is the premise of the card', () => {
    const { byKey } = group(MID_MONTH);

    for (const payment of byKey.get('rahul')!) {
      const sameMonth =
        payment.occurredAt.getFullYear() === MID_MONTH.getFullYear() &&
        payment.occurredAt.getMonth() === MID_MONTH.getMonth();

      // The suggestion is "you usually pay Rahul about now and have not
      // yet". A row in the current month would silence it.
      expect(sameMonth).toBe(false);
    }
  });

  it('clusters the habit on today\'s day of month, within a day either way', () => {
    const { byKey } = group(MID_MONTH);
    const days = byKey.get('rahul')!.map((p) => p.occurredAt.getDate());

    for (const day of days) {
      expect(Math.abs(day - MID_MONTH.getDate())).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the cluster tight even when built on the 1st of a month', () => {
    // The regression this guards: the jitter subtracts a day, and
    // setDate(0) is the last day of the PREVIOUS month. Unclamped, the
    // five dates land on days 1, 2 and 31 across six months, the spread
    // exceeds the detector's tolerance, and a demonstration given on
    // the 1st silently shows no recurring card at all.
    const firstOfMonth = new Date(2026, 6, 1, 9, 30, 0, 0);
    const { byKey } = group(firstOfMonth);
    const days = byKey.get('rahul')!.map((p) => p.occurredAt.getDate());

    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(3);

    for (const day of days) {
      expect(day).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the cluster tight at the end of a month too', () => {
    // 31 January: four of the five months have no 31st, and February
    // has only 28 or 29 days.
    const endOfMonth = new Date(2026, 0, 31, 9, 30, 0, 0);
    const { byKey } = group(endOfMonth);
    const days = byKey.get('rahul')!.map((p) => p.occurredAt.getDate());

    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(3);

    for (const payment of byKey.get('rahul')!) {
      const lastDay = new Date(
        payment.occurredAt.getFullYear(),
        payment.occurredAt.getMonth() + 1,
        0,
      ).getDate();

      expect(payment.occurredAt.getDate()).toBeLessThanOrEqual(lastDay);
    }
  });

  it('gives the most recent payment to SOMEONE ELSE', () => {
    const { byKey } = group(MID_MONTH);
    const latest = [...byKey.values()]
      .flat()
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

    // Otherwise the recurring card and the last-payment card would be
    // about the same person, and only one of them would ever show.
    expect(latest.payeeKey).toBe('priya');
    expect(byKey.get('priya')).toHaveLength(1);
  });

  it('dates that payment old enough to offer and new enough to matter', () => {
    const { byKey } = group(MID_MONTH);
    const [priya] = byKey.get('priya')!;
    const ageHours = (MID_MONTH.getTime() - priya.occurredAt.getTime()) / 3_600_000;

    // Between the detector's 24-hour floor and its 60-day ceiling.
    expect(ageHours).toBeGreaterThan(24);
    expect(ageHours).toBeLessThan(60 * 24);
  });

  it('gives Vinay a burst in one week that is NOT a monthly habit', () => {
    const { byKey } = group(MID_MONTH);
    const vinay = byKey.get('vinay')!;

    expect(vinay).toHaveLength(3);

    const months = new Set(
      vinay.map((p) => `${p.occurredAt.getFullYear()}-${p.occurredAt.getMonth()}`),
    );

    // Three payments, one month: frequent, but no pattern to repeat.
    expect(months.size).toBe(1);

    const dates = vinay.map((p) => p.occurredAt.getTime()).sort((a, b) => a - b);
    const spanDays = (dates[dates.length - 1] - dates[0]) / 86_400_000;

    expect(spanDays).toBeLessThanOrEqual(7);
  });

  it('is rebuilt on every call, so a caller cannot mutate the next one', () => {
    const first = buildDemoFixture(MID_MONTH);
    first.payees[0].displayName = 'Tampered';
    first.payments[0].amountMinor = 1;

    const second = buildDemoFixture(MID_MONTH);

    expect(second.payees[0].displayName).toBe('Rahul');
    expect(second.payments[0].amountMinor).toBe(500_000);
  });

  it('moves with the calendar rather than holding fixed dates', () => {
    const june = buildDemoFixture(new Date(2026, 5, 17, 9, 30));
    const july = buildDemoFixture(new Date(2026, 6, 17, 9, 30));

    expect(june.payments[0].occurredAt.getTime()).not.toBe(
      july.payments[0].occurredAt.getTime(),
    );
  });
});

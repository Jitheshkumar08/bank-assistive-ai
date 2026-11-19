import {
  DAY_MS,
  RECURRING_CLUSTER_TOLERANCE_DAYS,
  RECURRING_LOOKBACK_DAYS,
  RECURRING_MIN_OCCURRENCES,
  RECURRING_TODAY_TOLERANCE_DAYS,
  type PaymentHistoryItem,
  type RecurringAnalysis,
  type RecurringPayeeFinding,
  type RecurringTodayCandidate,
  type RecurringVerdict,
} from './types';

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function monthKey(date: Date): string {
  return date.getFullYear() + '-' + date.getMonth();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

/**
 * Two ways to read the date a habit lands on.
 *
 * Counting from the start of the month is the obvious one. Counting
 * back from the end of it is what a rent payment on the 31st actually
 * looks like once February has had its say: 31, 28, 31, 30 is chaos
 * from the front and zero from the back.
 *
 * Both are measured, and whichever clusters more tightly is the one the
 * pattern is judged on.
 */
function dayFromStart(date: Date): number {
  return date.getDate();
}

function dayFromEnd(date: Date): number {
  return daysInMonth(date) - date.getDate();
}

interface Pattern {
  modal: number;
  spread: number;
  fromEnd: boolean;
}

function describePattern(representatives: readonly Date[]): Pattern {
  const starts = representatives.map(dayFromStart);
  const ends = representatives.map(dayFromEnd);

  const spreadOf = (values: readonly number[]) => Math.max(...values) - Math.min(...values);

  const startSpread = spreadOf(starts);
  const endSpread = spreadOf(ends);

  return endSpread < startSpread
    ? { modal: median(ends), spread: endSpread, fromEnd: true }
    : { modal: median(starts), spread: startSpread, fromEnd: false };
}

/**
 * "You usually pay Rahul around this date. Shall we do that today?"
 *
 * A genuine monthly pattern, and only when today is the day it falls
 * on. The rules that keep it honest:
 *
 *   Three payments in THREE DIFFERENT MONTHS. Three in one week is a
 *   busy week, not a habit, and must never be offered as one.
 *
 *   The dates must cluster within a few days of each other, read from
 *   whichever end of the month holds them more tightly.
 *
 *   Today must be near that day. This card is about now; at any other
 *   time of the month it stays silent.
 *
 *   ALREADY PAID THIS CYCLE AND IT SAYS NOTHING. This is the rule that
 *   stops the assistant inviting someone to pay their rent twice, and
 *   it is checked against the calendar month, not a rolling window, so
 *   a payment made early still counts as this month's.
 *
 * This is the reasoning in full: the same decision
 * `detectRecurringToday` makes, with a finding recorded at every point
 * the loop would otherwise simply give up on a payee. Nothing here
 * reads a clock or a database.
 */
export function analyseRecurringToday(
  history: readonly PaymentHistoryItem[],
  now: Date,
): RecurringAnalysis {
  const windowStart = now.getTime() - RECURRING_LOOKBACK_DAYS * DAY_MS;

  const thresholds = {
    lookbackDays: RECURRING_LOOKBACK_DAYS,
    minOccurrences: RECURRING_MIN_OCCURRENCES,
    clusterToleranceDays: RECURRING_CLUSTER_TOLERANCE_DAYS,
    todayToleranceDays: RECURRING_TODAY_TOLERANCE_DAYS,
  };

  const byPayee = new Map<string, PaymentHistoryItem[]>();

  for (const item of history) {
    const at = item.occurredAt.getTime();

    if (at > now.getTime() || at < windowStart) continue;

    const existing = byPayee.get(item.payeeId);

    if (existing) existing.push(item);
    else byPayee.set(item.payeeId, [item]);
  }

  const findings: RecurringPayeeFinding[] = [];
  let best: RecurringTodayCandidate | null = null;

  for (const [payeeId, occurrences] of byPayee) {
    // One representative per month, so a month with two payments cannot
    // outvote the months around it.
    //
    // Grouped before the already-paid check purely so that every
    // finding below can report a month count. It is arithmetic over a
    // local map: no decision depends on where it happens.
    const months = new Map<string, PaymentHistoryItem[]>();

    for (const item of occurrences) {
      const key = monthKey(item.occurredAt);
      const existing = months.get(key);

      if (existing) existing.push(item);
      else months.set(key, [item]);
    }

    const partial = {
      payeeId,
      paymentCount: occurrences.length,
      distinctMonths: months.size,
    };

    // This cycle is already dealt with: say nothing at all.
    const paidThisMonth = occurrences.some(
      (item) => monthKey(item.occurredAt) === monthKey(now),
    );

    if (paidThisMonth) {
      findings.push({
        ...partial,
        verdict: 'ALREADY_PAID_THIS_MONTH',
        spread: null,
        modal: null,
        fromEnd: null,
        todayValue: null,
        representativeDates: [],
      });
      continue;
    }

    if (months.size < RECURRING_MIN_OCCURRENCES) {
      findings.push({
        ...partial,
        verdict: 'DISTINCT_MONTHS_TOO_FEW',
        spread: null,
        modal: null,
        fromEnd: null,
        todayValue: null,
        representativeDates: [],
      });
      continue;
    }

    const seed = median(occurrences.map((item) => dayFromStart(item.occurredAt)));

    const representatives = [...months.values()].map((group) =>
      group.reduce((closest, item) =>
        Math.abs(dayFromStart(item.occurredAt) - seed) <
        Math.abs(dayFromStart(closest.occurredAt) - seed)
          ? item
          : closest,
      ),
    );

    const pattern = describePattern(representatives.map((item) => item.occurredAt));
    const todayValue = pattern.fromEnd ? dayFromEnd(now) : dayFromStart(now);

    const measured = {
      ...partial,
      spread: pattern.spread,
      modal: pattern.modal,
      fromEnd: pattern.fromEnd,
      todayValue,
      representativeDates: representatives.map((item) => item.occurredAt),
    };

    if (pattern.spread > RECURRING_CLUSTER_TOLERANCE_DAYS) {
      findings.push({ ...measured, verdict: 'CLUSTER_TOO_WIDE' });
      continue;
    }

    if (Math.abs(todayValue - pattern.modal) > RECURRING_TODAY_TOLERANCE_DAYS) {
      findings.push({ ...measured, verdict: 'TODAY_OUTSIDE_WINDOW' });
      continue;
    }

    const latest = occurrences.reduce((newest, item) =>
      item.occurredAt.getTime() > newest.occurredAt.getTime() ? item : newest,
    );

    const usualDayOfMonth = pattern.fromEnd
      ? daysInMonth(now) - pattern.modal
      : Math.min(pattern.modal, daysInMonth(now));

    const candidate: RecurringTodayCandidate = {
      type: 'RECURRING_TODAY',
      payeeId,
      amountMinor: latest.amountMinor,
      lastOccurredAt: latest.occurredAt,
      provenance: latest.provenance,
      occurrenceCount: months.size,
      usualDayOfMonth,
    };

    findings.push({ ...measured, verdict: 'MATCHED' });

    // The strongest habit wins: more months first, then whichever was
    // paid most recently. More than one payee can qualify; only one is
    // ever offered, and the findings show the rest.
    const stronger =
      best === null ||
      candidate.occurrenceCount > best.occurrenceCount ||
      (candidate.occurrenceCount === best.occurrenceCount &&
        candidate.lastOccurredAt.getTime() > best.lastOccurredAt.getTime());

    if (stronger) best = candidate;
  }

  const verdict: RecurringVerdict = best
    ? 'MATCHED'
    : findings.length === 0
      ? 'NO_HISTORY_IN_WINDOW'
      : 'NO_PATTERN_MATCHED_TODAY';

  return {
    candidate: best,
    verdict,
    findings,
    windowStart: new Date(windowStart),
    thresholds,
  };
}

/**
 * The answer alone.
 *
 * Deliberately a wrapper and not a copy: there is one implementation of
 * this rule, and this is the production path into it.
 */
export function detectRecurringToday(
  history: readonly PaymentHistoryItem[],
  now: Date,
): RecurringTodayCandidate | null {
  return analyseRecurringToday(history, now).candidate;
}

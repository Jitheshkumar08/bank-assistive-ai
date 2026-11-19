/**
 * What the detectors see, and what they may conclude.
 *
 * Both detectors are pure functions over this list: no Prisma, no
 * clock of their own, no configuration lookup. Everything that decides
 * an outcome arrives as an argument, which is what makes the rules
 * testable to the day and to the rupee.
 *
 * ONLY PAYMENTS REACH HERE. Deposits, withdrawals and loan enquiries
 * are assisted activities, not payments, and must never produce a
 * remembered-payment suggestion.
 */

export type HistoryProvenance = 'DEMO_HISTORY' | 'ASSISTED_ACTIVITY' | 'BANK_VERIFIED';

/** One payment in the past, whichever source it came from. */
export interface PaymentHistoryItem {
  payeeId: string;
  amountMinor: number;
  occurredAt: Date;
  provenance: HistoryProvenance;
}

interface CandidateBase {
  payeeId: string;
  /** Taken from the most recent occurrence, so a changed amount wins. */
  amountMinor: number;
  lastOccurredAt: Date;
  provenance: HistoryProvenance;
}

export interface LastPaymentCandidate extends CandidateBase {
  type: 'LAST_PAYMENT';
}

export interface RecurringTodayCandidate extends CandidateBase {
  type: 'RECURRING_TODAY';
  occurrenceCount: number;
  /** The day this month that the habit lands on, for the card's wording. */
  usualDayOfMonth: number;
}

export type SuggestionCandidate = LastPaymentCandidate | RecurringTodayCandidate;

// --- Thresholds -----------------------------------------------------
//
// Exported so the tests assert against the same numbers the detectors
// use. A test that hardcodes its own copy of a threshold stops being a
// test of the rule.

/** Older than this and it is history, not a hint. */
export const LAST_PAYMENT_MAX_AGE_DAYS = 60;

/** Fresher than this and they have only just done it. */
export const LAST_PAYMENT_MIN_AGE_HOURS = 24;

export const RECURRING_LOOKBACK_DAYS = 180;

/** Two payments are a coincidence. Three, in different months, are a habit. */
export const RECURRING_MIN_OCCURRENCES = 3;

/** How tightly the dates must cluster before it counts as a pattern. */
export const RECURRING_CLUSTER_TOLERANCE_DAYS = 3;

/** How close today must be to the usual day. */
export const RECURRING_TODAY_TOLERANCE_DAYS = 2;

export const DAY_MS = 24 * 60 * 60 * 1000;

// --- Analysis -------------------------------------------------------
//
// A detector answers "what should we offer?". An analysis answers "and
// why?" -- the same single walk over the same history, with the
// reasoning kept rather than discarded at each `continue`.
//
// This exists so a testing dashboard can explain a verdict without a
// second copy of the rules. detect*() is a thin wrapper over
// analyse*(), so there is exactly ONE implementation and an
// explanation can never drift away from the decision it explains.

/** Why the recurring detector reached the answer it did, overall. */
export type RecurringVerdict =
  | 'MATCHED'
  /** Nothing at all inside the lookback window. */
  | 'NO_HISTORY_IN_WINDOW'
  /** There was history, but no payee qualified. See the findings. */
  | 'NO_PATTERN_MATCHED_TODAY';

/**
 * Why one payee qualified or did not.
 *
 * The detector decides per payee, so this is where a real reason lives.
 * The values are the detector's own exit points, in order.
 */
export type RecurringPayeeVerdict =
  | 'MATCHED'
  | 'ALREADY_PAID_THIS_MONTH'
  | 'DISTINCT_MONTHS_TOO_FEW'
  | 'CLUSTER_TOO_WIDE'
  | 'TODAY_OUTSIDE_WINDOW';

export interface RecurringPayeeFinding {
  payeeId: string;
  verdict: RecurringPayeeVerdict;
  /** Payments for this payee inside the lookback window. */
  paymentCount: number;
  /** Distinct calendar months those payments fall in. */
  distinctMonths: number;
  /** Spread of the representative dates. Null before it is measured. */
  spread: number | null;
  /** The day the habit lands on, in whichever metric clustered tighter. */
  modal: number | null;
  /** True when the pattern was read counting back from the month's end. */
  fromEnd: boolean | null;
  /** Today in that same metric, so it can be compared with `modal`. */
  todayValue: number | null;
  /**
   * The one payment per month the pattern was judged on.
   *
   * Dates rather than ids: a history item carries no id, because the
   * sources draw from different tables. A caller holding the rows
   * matches on payee and date.
   */
  representativeDates: Date[];
}

export interface RecurringAnalysis {
  candidate: RecurringTodayCandidate | null;
  verdict: RecurringVerdict;
  /** One per payee with history in the window, in encounter order. */
  findings: RecurringPayeeFinding[];
  /** The oldest date the window reaches back to. */
  windowStart: Date;
  /** The thresholds in force, so no caller restates them. */
  thresholds: {
    lookbackDays: number;
    minOccurrences: number;
    clusterToleranceDays: number;
    todayToleranceDays: number;
  };
}

export type LastPaymentVerdict = 'MATCHED' | 'NO_PAST_PAYMENTS' | 'TOO_OLD' | 'TOO_RECENT';

export interface LastPaymentAnalysis {
  candidate: LastPaymentCandidate | null;
  verdict: LastPaymentVerdict;
  /** The most recent payment considered, even when it was refused. */
  latestOccurredAt: Date | null;
  latestPayeeId: string | null;
  /** Its age at `now`, in hours. Fractional, so "too recent" is legible. */
  ageHours: number | null;
  thresholds: {
    maxAgeDays: number;
    minAgeHours: number;
  };
}

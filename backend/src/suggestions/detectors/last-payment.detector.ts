import {
  DAY_MS,
  LAST_PAYMENT_MAX_AGE_DAYS,
  LAST_PAYMENT_MIN_AGE_HOURS,
  type LastPaymentAnalysis,
  type LastPaymentCandidate,
  type PaymentHistoryItem,
} from './types';

const HOUR_MS = 60 * 60 * 1000;

/**
 * "Your last payment was to Rahul. Shall we do that again?"
 *
 * The most recent payment, and only a payment -- a deposit or a loan
 * enquiry is not an answer to this question, however recent it was.
 *
 * Two silences matter as much as the suggestion itself. Nothing older
 * than sixty days, because a two-month-old payment is not a hint about
 * today. And nothing newer than a day, because someone who paid this
 * morning does not need to be asked whether they would like to pay
 * again -- that is how a duplicate payment starts.
 *
 * This is the reasoning in full: the same decision `detectLastPayment`
 * makes, with the verdict and the numbers behind it kept instead of
 * collapsed to null. Nothing here reads a clock or a database.
 */
export function analyseLastPayment(
  history: readonly PaymentHistoryItem[],
  now: Date,
): LastPaymentAnalysis {
  const thresholds = {
    maxAgeDays: LAST_PAYMENT_MAX_AGE_DAYS,
    minAgeHours: LAST_PAYMENT_MIN_AGE_HOURS,
  };

  const past = history.filter((item) => item.occurredAt.getTime() <= now.getTime());

  if (past.length === 0) {
    return {
      candidate: null,
      verdict: 'NO_PAST_PAYMENTS',
      latestOccurredAt: null,
      latestPayeeId: null,
      ageHours: null,
      thresholds,
    };
  }

  const latest = past.reduce((newest, item) =>
    item.occurredAt.getTime() > newest.occurredAt.getTime() ? item : newest,
  );

  const age = now.getTime() - latest.occurredAt.getTime();

  // Carried on every answer from here on, refused or not, because the
  // reason a card stayed silent is exactly this payment's age.
  const considered = {
    latestOccurredAt: latest.occurredAt,
    latestPayeeId: latest.payeeId,
    ageHours: age / HOUR_MS,
    thresholds,
  };

  if (age > LAST_PAYMENT_MAX_AGE_DAYS * DAY_MS) {
    return { candidate: null, verdict: 'TOO_OLD', ...considered };
  }

  if (age < LAST_PAYMENT_MIN_AGE_HOURS * HOUR_MS) {
    return { candidate: null, verdict: 'TOO_RECENT', ...considered };
  }

  return {
    candidate: {
      type: 'LAST_PAYMENT',
      payeeId: latest.payeeId,
      amountMinor: latest.amountMinor,
      lastOccurredAt: latest.occurredAt,
      provenance: latest.provenance,
    },
    verdict: 'MATCHED',
    ...considered,
  };
}

/**
 * The answer alone.
 *
 * Deliberately a wrapper and not a copy: there is one implementation of
 * this rule, and this is the production path into it.
 */
export function detectLastPayment(
  history: readonly PaymentHistoryItem[],
  now: Date,
): LastPaymentCandidate | null {
  return analyseLastPayment(history, now).candidate;
}

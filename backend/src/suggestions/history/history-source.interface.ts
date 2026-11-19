import type { PaymentHistoryItem } from '../detectors/types';

/**
 * Where a customer's past payments come from.
 *
 * One port, several sources, because the three kinds of record in this
 * system must never be merged in the database:
 *
 *   DemoHistorySource       seeded demonstration data, flag-gated
 *   AssistedActivitySource  payments the assistant guided to completion
 *   (future) BankFeedSource a genuine transaction feed
 *
 * A real feed is added by writing one more class and listing it in the
 * module. The detectors, the service and the API do not change, and the
 * provenance each source stamps on its items is what keeps demo data
 * labelled as demo all the way to the screen.
 */
export interface PaymentHistorySource {
  /** Stamped onto every item, so nothing loses track of its origin. */
  readonly provenance: PaymentHistoryItem['provenance'];

  /** This customer's payments at or after `since`. Order is irrelevant. */
  paymentsFor(userId: string, since: Date): Promise<PaymentHistoryItem[]>;
}

/** DI token for the list of sources a deployment has enabled. */
export const PAYMENT_HISTORY_SOURCES = Symbol('PAYMENT_HISTORY_SOURCES');

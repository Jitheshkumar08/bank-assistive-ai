import type { AssistedActivityKind, PayeeTrust } from '@prisma/client';
import type { HistoryProvenance, SuggestionCandidate } from '../detectors/types';

/**
 * What crosses the wire.
 *
 * Two omissions are deliberate and load-bearing:
 *
 *   No full account number. There is no column for one, so there is
 *   nothing here to leak.
 *
 *   No ready-made sentence. The browser composes the wording from its
 *   own per-language templates, so a Kannada customer never has an
 *   English fragment stitched into their greeting.
 */
export interface SuggestionPayeeView {
  /** A first name, because this is the part that gets spoken. */
  displayName: string;
  fullName: string | null;
  accountLast4: string | null;
  /** DEMO_SEEDED must never be presented as a bank-verified recipient. */
  trust: PayeeTrust;
}

export interface SuggestionView {
  /** Opaque offer id. The only thing /continue accepts. */
  id: string;
  type: SuggestionCandidate['type'];
  kind: AssistedActivityKind;
  provenance: HistoryProvenance;
  /**
   * False everywhere in this version: nothing here is a bank record.
   * The browser shows the Demo History badge whenever this is false.
   */
  isBankVerified: boolean;
  payee: SuggestionPayeeView;
  amountMinor: number;
  currency: string;
  lastOccurredAt: string;
  /** Recurring only: how many months the habit spans. */
  occurrenceCount: number | null;
  /** Recurring only: the day this month the habit lands on. */
  usualDayOfMonth: number | null;
}

export interface SuggestionListView {
  suggestions: SuggestionView[];
}

export interface ActivityReviewView {
  kind: AssistedActivityKind;
  provenance: HistoryProvenance;
  isBankVerified: boolean;
  payee: SuggestionPayeeView | null;
  amountMinor: number | null;
  currency: string;
}

export interface ContinueSuggestionView {
  activityId: string;
  review: ActivityReviewView;
}

/**
 * Remembered payments, as the API describes them.
 *
 * Two things are deliberately absent, and the UI depends on their
 * absence: there is no full account number anywhere in these shapes,
 * and there is no ready-made sentence. The wording is composed here
 * from per-language templates so a Kannada customer never hears an
 * English fragment stitched into their greeting.
 */
export type SuggestionType = 'LAST_PAYMENT' | 'RECURRING_TODAY';

export type AssistedActivityKind =
  | 'PAYMENT_GUIDANCE'
  | 'DEPOSIT_GUIDANCE'
  | 'WITHDRAWAL_GUIDANCE'
  | 'LOAN_ENQUIRY';

export type AssistedActivityStatus =
  | 'STARTED'
  | 'CONFIRMED'
  | 'GUIDANCE_COMPLETED'
  | 'ABANDONED'
  | 'CANCELLED';

/** Where a suggestion's evidence came from. Drives the Demo History badge. */
export type HistoryProvenance = 'DEMO_HISTORY' | 'ASSISTED_ACTIVITY' | 'BANK_VERIFIED';

/** How much a destination can be trusted. DEMO_SEEDED is never "verified". */
export type PayeeTrust = 'DEMO_SEEDED' | 'CUSTOMER_PROVIDED' | 'BANK_VERIFIED';

export interface SuggestionPayee {
  displayName: string;
  fullName: string | null;
  accountLast4: string | null;
  trust: PayeeTrust;
}

export interface Suggestion {
  /** Opaque offer id: the only thing the continue call accepts. */
  id: string;
  type: SuggestionType;
  kind: AssistedActivityKind;
  provenance: HistoryProvenance;
  /** False for everything this version can produce. */
  isBankVerified: boolean;
  payee: SuggestionPayee;
  amountMinor: number;
  currency: string;
  lastOccurredAt: string;
  occurrenceCount: number | null;
  usualDayOfMonth: number | null;
}

export interface SuggestionList {
  suggestions: Suggestion[];
}

export interface ActivityReview {
  kind: AssistedActivityKind;
  provenance: HistoryProvenance;
  isBankVerified: boolean;
  payee: SuggestionPayee | null;
  amountMinor: number | null;
  currency: string;
}

export interface ContinueSuggestion {
  activityId: string;
  review: ActivityReview;
}

export interface ActivityReviewResponse {
  activityId: string;
  status: AssistedActivityStatus;
  review: ActivityReview;
}

/**
 * Which existing request the customer is handed over with. Chosen by the
 * server, turned into a phrase in the customer's language here, so the
 * hand-over is never free text from the page.
 */
export type HandOverRequestKey = 'PAYMENT' | 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN';

export interface ConfirmActivityResponse {
  activityId: string;
  status: AssistedActivityStatus;
  handOver: { requestKey: HandOverRequestKey };
}

export interface ActivityHistoryItem {
  id: string;
  kind: AssistedActivityKind;
  status: AssistedActivityStatus;
  payee: { displayName: string; accountLast4: string | null } | null;
  amountMinor: number | null;
  currency: string;
  occurredAt: string;
  completedAt: string | null;
}

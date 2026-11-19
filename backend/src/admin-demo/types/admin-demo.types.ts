import type {
  DemoPaymentStatus,
  HistoryProvenance,
  PayeeTrust,
  SuggestionType,
} from '@prisma/client';
import type {
  LastPaymentVerdict,
  RecurringPayeeVerdict,
  RecurringVerdict,
} from '../../suggestions/detectors/types';

/**
 * What the development-only testing dashboard sends to the browser.
 *
 * Masked exactly as the customer's own screens are: a display name and
 * four digits. There is no column for a full account number anywhere in
 * this system, and being an admin screen does not invent one.
 */

export interface DemoCustomerSummary {
  userId: string;
  email: string;
  fullName: string;
  preferredLanguage: string;
  /** The customer's own opt-in. The welcome screen honours it; `evaluate` does not. */
  suggestionsEnabled: boolean;
  demoPaymentCount: number;
  demoPayeeCount: number;
  lastDemoPaymentAt: string | null;
}

/** Why a row the detectors never saw was left out. */
export type IgnoredReason = 'NOT_COMPLETED' | 'OUTSIDE_LOOKBACK' | 'FUTURE_DATED';

export interface DemoPayeeView {
  id: string;
  displayName: string;
  fullName: string | null;
  accountLast4: string | null;
  trust: PayeeTrust;
}

export interface DemoPaymentRow {
  id: string;
  payee: DemoPayeeView;
  amountMinor: number;
  currency: string;
  status: DemoPaymentStatus;
  occurredAt: string;
  createdAt: string;
  /** True when this row is part of the history the detectors read. */
  countsTowardSuggestions: boolean;
  ignoredReason: IgnoredReason | null;
}

export interface DemoPaymentsView {
  customer: DemoCustomerSummary;
  /** The moment the annotations were computed against. */
  evaluatedAt: string;
  isSimulated: boolean;
  /** Oldest date the detectors' window reaches. */
  lookbackStart: string;
  payments: DemoPaymentRow[];
}

/**
 * A row as just written.
 *
 * Deliberately without `countsTowardSuggestions` and `ignoredReason`:
 * those depend on the moment being evaluated, and a write carries no
 * simulated date. The caller re-reads the annotated list afterwards,
 * which is also what keeps the table and the preview describing the
 * same moment.
 */
export interface DemoPaymentWritten {
  id: string;
  payee: DemoPayeeView;
  amountMinor: number;
  currency: string;
  status: DemoPaymentStatus;
  occurredAt: string;
  createdAt: string;
}

export interface PreviewCandidateView {
  type: SuggestionType;
  payeeId: string;
  displayName: string;
  accountLast4: string | null;
  amountMinor: number;
  currency: string;
  lastOccurredAt: string;
  provenance: HistoryProvenance;
  /** Always false in this version: nothing here is a bank record. */
  isBankVerified: boolean;
  occurrenceCount: number | null;
  usualDayOfMonth: number | null;
}

export interface RecurringFindingView {
  payeeId: string;
  displayName: string;
  verdict: RecurringPayeeVerdict;
  paymentCount: number;
  distinctMonths: number;
  spread: number | null;
  modal: number | null;
  fromEnd: boolean | null;
  todayValue: number | null;
  representativeDates: string[];
}

/**
 * Whether a suggestion would actually reach the welcome screen.
 *
 * `evaluate()` answers only "do the rules produce a card?". Two gates
 * sit above it that it deliberately does not apply, and an admin
 * looking at a card here needs to know when one of them would silence
 * it anyway.
 */
export interface PreviewGating {
  /** SUGGESTIONS_ENABLED, the deployment-wide switch. */
  suggestionsEnabledGlobally: boolean;
  /** The customer's own setting. */
  accountOptedIn: boolean;
  /** DEMO_HISTORY_ENABLED: with it off, demo rows are not even read. */
  demoHistoryEnabled: boolean;
  /** All gates open AND at least one card. */
  wouldAppearOnWelcome: boolean;
}

export interface DemoPreviewView {
  customer: DemoCustomerSummary;
  evaluatedAt: string;
  isSimulated: boolean;
  lookbackStart: string;
  gating: PreviewGating;

  /** Every demo row on file, before any rule. */
  historyTotal: number;
  /** Payments the sources actually handed the detectors. */
  historyUsed: number;
  excludedByStatus: number;
  excludedByWindow: number;
  excludedAsFuture: number;

  recurring: {
    verdict: RecurringVerdict;
    thresholds: {
      lookbackDays: number;
      minOccurrences: number;
      clusterToleranceDays: number;
      todayToleranceDays: number;
    };
    findings: RecurringFindingView[];
    candidate: PreviewCandidateView | null;
  };

  last: {
    verdict: LastPaymentVerdict;
    thresholds: { maxAgeDays: number; minAgeHours: number };
    latestOccurredAt: string | null;
    latestPayeeId: string | null;
    latestPayeeName: string | null;
    ageHours: number | null;
    candidate: PreviewCandidateView | null;
  };

  /** What `list()` would turn into offers, in the same order. */
  wouldOffer: PreviewCandidateView[];
  /** Silenced by past refusals rather than by the rules. */
  suppressed: Array<{
    type: SuggestionType;
    payeeId: string;
    displayName: string;
    declineCount: number;
  }>;
  unresolvedPayeeIds: string[];
}

/**
 * What clearing a customer's demonstration history removed.
 *
 * `payeesRetained` is the honest part. A DEMO_SEEDED payee that an
 * assisted activity or a suggestion offer still refers to is KEPT:
 * both of those relations are `onDelete: SetNull`, so deleting the
 * payee would blank a column in a table this module promises never to
 * write. An unused beneficiary row costs nothing; a branch visit that
 * forgot who it was about costs a record.
 */
export interface DemoResetView {
  customer: DemoCustomerSummary;
  paymentsDeleted: number;
  payeesDeleted: number;
  payeesRetained: number;
}

/**
 * What restoring the seeded fixture did.
 *
 * Restore clears first, then writes the fixture from
 * src/admin-demo/demo-fixture.ts -- the same definition the seed script
 * uses, so "restored" means the state a freshly seeded machine starts
 * in rather than an approximation of it.
 *
 * `payeesReused` exists because a payee the clear had to keep is
 * matched by name and last four digits rather than duplicated, so
 * restoring twice leaves one Rahul, not two.
 */
export interface DemoRestoreView {
  customer: DemoCustomerSummary;
  cleared: {
    paymentsDeleted: number;
    payeesDeleted: number;
    payeesRetained: number;
  };
  payeesCreated: number;
  payeesReused: number;
  paymentsCreated: number;
}

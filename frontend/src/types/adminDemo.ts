/**
 * The development-only personalisation testing dashboard.
 *
 * Mirrors backend/src/admin-demo/types/admin-demo.types.ts. Payees are
 * masked here exactly as they are on a customer's own card: a display
 * name and four digits, because no full account number exists anywhere
 * in this system to send.
 */

export type DemoPaymentStatus = 'COMPLETED' | 'FAILED' | 'PENDING';

export type PayeeTrust = 'DEMO_SEEDED' | 'CUSTOMER_PROVIDED' | 'BANK_VERIFIED';

export type HistoryProvenance = 'DEMO_HISTORY' | 'ASSISTED_ACTIVITY' | 'BANK_VERIFIED';

export type SuggestionKind = 'LAST_PAYMENT' | 'RECURRING_TODAY';

export type IgnoredReason = 'NOT_COMPLETED' | 'OUTSIDE_LOOKBACK' | 'FUTURE_DATED';

export type RecurringVerdict = 'MATCHED' | 'NO_HISTORY_IN_WINDOW' | 'NO_PATTERN_MATCHED_TODAY';

export type RecurringPayeeVerdict =
  | 'MATCHED'
  | 'ALREADY_PAID_THIS_MONTH'
  | 'DISTINCT_MONTHS_TOO_FEW'
  | 'CLUSTER_TOO_WIDE'
  | 'TODAY_OUTSIDE_WINDOW';

export type LastPaymentVerdict = 'MATCHED' | 'NO_PAST_PAYMENTS' | 'TOO_OLD' | 'TOO_RECENT';

export interface DemoCustomerSummary {
  userId: string;
  email: string;
  fullName: string;
  preferredLanguage: string;
  suggestionsEnabled: boolean;
  demoPaymentCount: number;
  demoPayeeCount: number;
  lastDemoPaymentAt: string | null;
}

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
  countsTowardSuggestions: boolean;
  ignoredReason: IgnoredReason | null;
}

export interface DemoPaymentsView {
  customer: DemoCustomerSummary;
  evaluatedAt: string;
  isSimulated: boolean;
  lookbackStart: string;
  payments: DemoPaymentRow[];
}

/** A new beneficiary, always stored as demonstration data. */
export interface NewDemoPayeeInput {
  displayName: string;
  fullName?: string;
  /** Exactly four digits: there is no column for more. */
  accountLast4: string;
}

/**
 * Adding one demonstration record.
 *
 * Exactly one of `payeeId` and `newPayee`. No `currency`: INR is the
 * only one supported, and the server rejects the field outright rather
 * than pretending to honour it.
 */
export interface CreateDemoPaymentInput {
  payeeId?: string;
  newPayee?: NewDemoPayeeInput;
  amountMinor: number;
  occurredAt: string;
  status: DemoPaymentStatus;
}

/** Changing one. Send only what changed; an empty body is refused. */
export interface UpdateDemoPaymentInput {
  payeeId?: string;
  amountMinor?: number;
  occurredAt?: string;
  status?: DemoPaymentStatus;
}

/**
 * A row as just written.
 *
 * Without the "does this count?" annotations, which depend on the
 * moment being evaluated — the caller re-reads the annotated list
 * afterwards, which is what keeps the table and the preview describing
 * the same moment.
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

export interface PreviewCandidate {
  type: SuggestionKind;
  payeeId: string;
  displayName: string;
  accountLast4: string | null;
  amountMinor: number;
  currency: string;
  lastOccurredAt: string;
  provenance: HistoryProvenance;
  isBankVerified: boolean;
  occurrenceCount: number | null;
  usualDayOfMonth: number | null;
}

export interface RecurringFinding {
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

export interface PreviewGating {
  suggestionsEnabledGlobally: boolean;
  accountOptedIn: boolean;
  demoHistoryEnabled: boolean;
  wouldAppearOnWelcome: boolean;
}

export interface DemoPreview {
  customer: DemoCustomerSummary;
  evaluatedAt: string;
  isSimulated: boolean;
  lookbackStart: string;
  gating: PreviewGating;

  historyTotal: number;
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
    findings: RecurringFinding[];
    candidate: PreviewCandidate | null;
  };

  last: {
    verdict: LastPaymentVerdict;
    thresholds: { maxAgeDays: number; minAgeHours: number };
    latestOccurredAt: string | null;
    latestPayeeId: string | null;
    latestPayeeName: string | null;
    ageHours: number | null;
    candidate: PreviewCandidate | null;
  };

  wouldOffer: PreviewCandidate[];
  suppressed: Array<{
    type: SuggestionKind;
    payeeId: string;
    displayName: string;
    declineCount: number;
  }>;
  unresolvedPayeeIds: string[];
}

/**
 * What clearing a customer's demonstration history removed.
 *
 * `payeesRetained` is counted rather than hidden. A seeded beneficiary
 * that an assisted activity or a suggestion offer still refers to is
 * kept, because removing it would blank a column in a record the
 * dashboard has no business editing.
 */
export interface DemoResetResult {
  customer: DemoCustomerSummary;
  paymentsDeleted: number;
  payeesDeleted: number;
  payeesRetained: number;
}

/** What restoring the seeded fixture did, clearing included. */
export interface DemoRestoreResult {
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

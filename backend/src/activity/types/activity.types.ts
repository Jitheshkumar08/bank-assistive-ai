import type { AssistedActivityKind, AssistedActivityStatus } from '@prisma/client';

/**
 * The key the browser turns into a request phrase in the customer's own
 * language. Fixed and server-chosen: the hand-over to the assistant is
 * never free text from a client.
 */
export type HandOverRequestKey = 'PAYMENT' | 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN';

export interface ConfirmActivityView {
  activityId: string;
  status: AssistedActivityStatus;
  /**
   * Where the customer goes next: the EXISTING assistant conversation.
   * This response makes no claim that a payment has been made, because
   * nothing in this system can make one.
   */
  handOver: { requestKey: HandOverRequestKey };
}

export interface ActivityHistoryItemView {
  id: string;
  kind: AssistedActivityKind;
  status: AssistedActivityStatus;
  payee: { displayName: string; accountLast4: string | null } | null;
  amountMinor: number | null;
  currency: string;
  occurredAt: string;
  completedAt: string | null;
}

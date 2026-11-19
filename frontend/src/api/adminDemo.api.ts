import { api } from './client';
import type {
  CreateDemoPaymentInput,
  DemoCustomerSummary,
  DemoPaymentWritten,
  DemoPaymentsView,
  DemoPreview,
  DemoResetResult,
  DemoRestoreResult,
  UpdateDemoPaymentInput,
} from '@/types/adminDemo';

/**
 * The development-only testing dashboard.
 *
 * All three reads are GETs, the preview among them: that it creates no
 * suggestion offer and touches no customer session is visible from the
 * method rather than taken on trust.
 *
 * `at` is the simulated date. Left out, the server uses the real
 * present.
 */
function withDate(path: string, at: string | null): string {
  return at ? `${path}?at=${encodeURIComponent(at)}` : path;
}

export const adminDemoApi = {
  customers: (signal?: AbortSignal) =>
    api.get<DemoCustomerSummary[]>('/admin/demo/customers', signal),

  payments: (userId: string, at: string | null, signal?: AbortSignal) =>
    api.get<DemoPaymentsView>(
      withDate(`/admin/demo/customers/${encodeURIComponent(userId)}/payments`, at),
      signal,
    ),

  preview: (userId: string, at: string | null, signal?: AbortSignal) =>
    api.get<DemoPreview>(
      withDate(`/admin/demo/customers/${encodeURIComponent(userId)}/preview`, at),
      signal,
    ),

  // Writes. Every one is nested under the customer it belongs to, so a
  // row is always resolved by payment AND customer -- a request aimed
  // at the wrong customer finds nothing rather than changing someone
  // else's history.

  create: (userId: string, input: CreateDemoPaymentInput, signal?: AbortSignal) =>
    api.post<DemoPaymentWritten>(
      `/admin/demo/customers/${encodeURIComponent(userId)}/payments`,
      input,
      signal,
    ),

  update: (
    userId: string,
    paymentId: string,
    input: UpdateDemoPaymentInput,
    signal?: AbortSignal,
  ) =>
    api.patch<DemoPaymentWritten>(
      `/admin/demo/customers/${encodeURIComponent(userId)}/payments/${encodeURIComponent(
        paymentId,
      )}`,
      input,
      signal,
    ),

  remove: (userId: string, paymentId: string, signal?: AbortSignal) =>
    api.delete<void>(
      `/admin/demo/customers/${encodeURIComponent(userId)}/payments/${encodeURIComponent(
        paymentId,
      )}`,
      signal,
    ),

  /**
   * Clears one customer's demonstration history.
   *
   * The collection rather than one row, which is why it is the same
   * verb as `remove` without a payment id.
   */
  reset: (userId: string, signal?: AbortSignal) =>
    api.delete<DemoResetResult>(
      `/admin/demo/customers/${encodeURIComponent(userId)}/payments`,
      signal,
    ),

  /** Writes the seeded fixture back -- the state a fresh seed produces. */
  restore: (userId: string, signal?: AbortSignal) =>
    api.post<DemoRestoreResult>(
      `/admin/demo/customers/${encodeURIComponent(userId)}/restore`,
      undefined,
      signal,
    ),
};

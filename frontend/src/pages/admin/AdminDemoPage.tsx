import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/admin/demo/ConfirmDialog';
import { DemoCustomerSelect } from '@/components/admin/demo/DemoCustomerSelect';
import { DemoCustomerStrip } from '@/components/admin/demo/DemoCustomerStrip';
import { DemoHistoryTable } from '@/components/admin/demo/DemoHistoryTable';
import { DemoPaymentDialog } from '@/components/admin/demo/DemoPaymentDialog';
import { PreviewPanel } from '@/components/admin/demo/PreviewPanel';
import { SimulatedDateControl } from '@/components/admin/demo/SimulatedDateControl';
import { adminDemoApi } from '@/api/adminDemo.api';
import { ApiError } from '@/types/api';
import { formatAmount } from '@/lib/suggestionCopy';
import type {
  CreateDemoPaymentInput,
  DemoCustomerSummary,
  DemoPayeeView,
  DemoPaymentRow,
  DemoPaymentsView,
  DemoPreview,
  DemoResetResult,
  DemoRestoreResult,
  UpdateDemoPaymentInput,
} from '@/types/adminDemo';

/**
 * The two actions that act on the whole of a customer's history.
 *
 * Kept as one piece of state rather than two booleans, so "clearing"
 * and "restoring" cannot both be in progress and the dialog always has
 * exactly one thing to ask about.
 */
type BulkAction = 'reset' | 'restore';

/** One beneficiary kept back, explained once rather than in two places. */
function retainedNote(retained: number): string {
  if (retained === 0) return '';

  return (
    ` ${retained} beneficiar${retained === 1 ? 'y was' : 'ies were'} kept: an assisted` +
    ' activity or an earlier suggestion still refers to them.'
  );
}

/**
 * Mirrors ACTIVITY_MAX_AMOUNT_MINOR for early feedback only.
 *
 * The server is the authority and validates independently; this just
 * saves a round trip. If a deployment lowers the limit, the server
 * still refuses and its message is what gets shown.
 */
const MAX_AMOUNT_MINOR = 1_000_000;

/**
 * The personalisation testing dashboard. DEVELOPMENT ONLY.
 *
 * Pick a customer, pick a date, and see what the detectors would
 * conclude and why. The table and the preview are fetched with the SAME
 * `at`, so what is highlighted as counting always agrees with the
 * verdict beside it.
 *
 * This screen cannot move money, cannot create a suggestion offer and
 * cannot touch a customer's visit. It edits demonstration records and
 * it reads.
 */
export function AdminDemoPage() {
  const [customers, setCustomers] = useState<DemoCustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);

  const [history, setHistory] = useState<DemoPaymentsView | null>(null);
  const [preview, setPreview] = useState<DemoPreview | null>(null);

  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  /**
   * Bumped after every successful write.
   *
   * It sits in the dependency list of BOTH effects, so one counter
   * refreshes the customer counts, the annotated history and the
   * preview together -- with the same `at` as before, which is how the
   * table and the verdict keep describing the same moment.
   */
  const [revision, setRevision] = useState(0);

  // Write state, kept separate from the read state so a failed write
  // never blanks what is on screen.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DemoPaymentRow | null>(null);
  const [confirming, setConfirming] = useState<DemoPaymentRow | null>(null);
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  /**
   * What the last whole-history action actually did.
   *
   * Clearing an empty history and restoring over a full one both leave
   * a table that looks plausible, so the counts are reported rather
   * than left to be inferred from the screen.
   */
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const list = await adminDemoApi.customers(controller.signal);

        setCustomers(list);
        setError(null);

        // The account with the most demonstration history is the one
        // worth looking at first.
        if (list.length > 0) setSelectedId((current) => current ?? list[0].userId);
      } catch (caught) {
        if (caught instanceof ApiError && caught.isNetworkError && controller.signal.aborted) {
          return;
        }

        // A 404 here is the honest answer of a deployment where demo
        // management is switched off, not a bug.
        if (caught instanceof ApiError && caught.status === 404) {
          setUnavailable(true);
        } else {
          setError(
            caught instanceof ApiError ? caught.message : 'Could not load the demo customers.',
          );
        }
      } finally {
        setLoadingCustomers(false);
      }
    })();

    return () => controller.abort();
  }, [revision]);

  const loadDetail = useCallback(
    async (userId: string, moment: string | null, signal: AbortSignal): Promise<void> => {
      setLoadingDetail(true);

      try {
        // One `at` for both, so the table and the verdict can never
        // describe different moments.
        const [payments, evaluated] = await Promise.all([
          adminDemoApi.payments(userId, moment, signal),
          adminDemoApi.preview(userId, moment, signal),
        ]);

        setHistory(payments);
        setPreview(evaluated);
        setError(null);
      } catch (caught) {
        if (signal.aborted) return;

        setError(
          caught instanceof ApiError ? caught.message : 'Could not evaluate that customer.',
        );
      } finally {
        if (!signal.aborted) setLoadingDetail(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedId) return;

    const controller = new AbortController();

    void loadDetail(selectedId, at, controller.signal);

    return () => controller.abort();
  }, [selectedId, at, revision, loadDetail]);

  /** Existing demonstration beneficiaries, for the dialog's payee list. */
  const payees = useMemo<DemoPayeeView[]>(() => {
    const seen = new Map<string, DemoPayeeView>();

    for (const row of history?.payments ?? []) {
      if (row.payee.trust === 'DEMO_SEEDED') seen.set(row.payee.id, row.payee);
    }

    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [history]);

  /**
   * One place every write passes through.
   *
   * On success it bumps `revision`, which re-reads the counts, the
   * history and the preview. On failure it leaves the screen alone and
   * puts the server's own message in front of whoever is looking --
   * never a cheerful guess about what went wrong.
   *
   * It answers with what the server said, wrapped, so success is still
   * a plain truthiness check while a caller that needs the counts can
   * read them from the same call that performed the write.
   */
  async function runWrite<T>(action: () => Promise<T>): Promise<{ value: T } | null> {
    setWriting(true);
    setWriteError(null);

    try {
      const value = await action();
      setRevision((current) => current + 1);

      return { value };
    } catch (caught) {
      setWriteError(
        caught instanceof ApiError ? caught.message : 'That change could not be saved.',
      );

      return null;
    } finally {
      setWriting(false);
    }
  }

  async function handleCreate(input: CreateDemoPaymentInput): Promise<void> {
    if (!selectedId) return;

    const ok = await runWrite(() => adminDemoApi.create(selectedId, input));

    if (ok) setDialogOpen(false);
  }

  async function handleUpdate(changes: UpdateDemoPaymentInput): Promise<void> {
    if (!selectedId || !editing) return;

    const ok = await runWrite(() => adminDemoApi.update(selectedId, editing.id, changes));

    if (ok) {
      setDialogOpen(false);
      setEditing(null);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedId || !confirming) return;

    const ok = await runWrite(() => adminDemoApi.remove(selectedId, confirming.id));

    if (ok) setConfirming(null);
  }

  /**
   * Clears every demonstration record for the selected customer.
   *
   * The server decides what may go: beneficiaries the customer entered
   * themselves are not reachable by this call at all, and a seeded one
   * that an assisted activity still refers to is kept and counted back.
   */
  async function handleReset(): Promise<void> {
    if (!selectedId) return;

    const result = await runWrite<DemoResetResult>(() => adminDemoApi.reset(selectedId));

    if (!result) return;

    const { paymentsDeleted, payeesDeleted, payeesRetained } = result.value;

    setNote(
      `Cleared ${paymentsDeleted} payment${paymentsDeleted === 1 ? '' : 's'} and ` +
        `${payeesDeleted} beneficiar${payeesDeleted === 1 ? 'y' : 'ies'}.` +
        retainedNote(payeesRetained),
    );
    setBulk(null);
  }

  /** Writes the seeded fixture back: what a freshly seeded machine has. */
  async function handleRestore(): Promise<void> {
    if (!selectedId) return;

    const result = await runWrite<DemoRestoreResult>(() =>
      adminDemoApi.restore(selectedId),
    );

    if (!result) return;

    const { paymentsCreated, payeesCreated, payeesReused, cleared } = result.value;

    setNote(
      `Restored ${paymentsCreated} payment${paymentsCreated === 1 ? '' : 's'} across ` +
        `${payeesCreated + payeesReused} beneficiaries, replacing ` +
        `${cleared.paymentsDeleted} that were there before.` +
        retainedNote(cleared.payeesRetained),
    );
    setBulk(null);
  }

  function openAdd(): void {
    setEditing(null);
    setWriteError(null);
    setDialogOpen(true);
  }

  function openBulk(action: BulkAction): void {
    setWriteError(null);
    setNote(null);
    setBulk(action);
  }

  function openEdit(row: DemoPaymentRow): void {
    setEditing(row);
    setWriteError(null);
    setDialogOpen(true);
  }

  if (unavailable) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink-900">
          Personalisation testing
        </h1>
        <Alert tone="info" title="Not available here">
          This dashboard is served only when <code>NODE_ENV</code> is not production and both{' '}
          <code>DEMO_HISTORY_ENABLED</code> and <code>DEMO_DASHBOARD_ENABLED</code> are
          <code> true</code>. On a production deployment its routes do not exist at all.
        </Alert>
      </div>
    );
  }

  const matched = preview?.recurring.candidate;
  const nothingToClear =
    history !== null &&
    history.payments.length === 0 &&
    history.customer.demoPayeeCount === 0;
  const patternDates =
    preview?.recurring.findings.find((finding) => finding.verdict === 'MATCHED')
      ?.representativeDates ?? [];
  const counted = history?.payments.filter((row) => row.countsTowardSuggestions).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink-900 sm:text-3xl">
            Personalisation testing
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200 ring-inset">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
            Development only
          </span>
        </div>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-ink-500">
          Seeded demonstration history and what the detectors make of it. These records are not
          bank statements, and nothing on this screen moves money.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {/* Both inputs that decide what the whole page is about, together
          in one bar: the customer, and the moment. */}
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70 sm:flex-row sm:items-start sm:gap-5">
        <div className="min-w-0 sm:w-72 sm:shrink-0">
          <DemoCustomerSelect
            customers={customers}
            selectedId={selectedId}
            onSelect={(userId) => {
              // A count from the previous customer would be read as
              // this one's.
              setNote(null);
              setSelectedId(userId);
            }}
            disabled={loadingCustomers}
          />
        </div>

        <span
          aria-hidden="true"
          className="hidden w-px self-stretch bg-ink-100 sm:block"
        />

        <div className="min-w-0 flex-1">
          <SimulatedDateControl at={at} onChange={setAt} disabled={!selectedId} />
        </div>
      </div>

      {loadingCustomers ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6 text-brand-600" label="Loading demo customers" />
        </div>
      ) : customers.length === 0 ? (
        <Alert tone="info">
          There are no customer accounts to test with yet. Register one, or run the seed script.
        </Alert>
      ) : (
        <>
          {history && <DemoCustomerStrip customer={history.customer} />}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_24rem]">
            <section aria-labelledby="history-heading" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2
                    id="history-heading"
                    className="text-base font-semibold tracking-[-0.01em] text-ink-900"
                  >
                    Payment history
                  </h2>
                  {history && (
                    <p className="text-xs text-ink-500">
                      {history.payments.length} row
                      {history.payments.length === 1 ? '' : 's'} · {counted} read by the
                      detectors
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    fullWidth={false}
                    onClick={() => openBulk('restore')}
                    disabled={!selectedId || writing}
                    title="Write the standard nine-record fixture back"
                  >
                    Restore seeded history
                  </Button>
                  {/*
                    Destructive, so it is not dressed the same as the
                    action next to it -- but not shouted either: it is
                    a routine step on a testing screen.
                  */}
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    fullWidth={false}
                    onClick={() => openBulk('reset')}
                    // Nothing to clear is not an error, but a button that
                    // would report zeroes is not worth offering either.
                    disabled={!selectedId || writing || nothingToClear}
                    title={
                      nothingToClear
                        ? 'There is nothing on file to clear'
                        : "Delete this customer's demonstration records"
                    }
                    className="text-danger-700 hover:bg-danger-50 hover:ring-danger-500/30"
                  >
                    Clear history
                  </Button>
                  <Button
                    type="button"
                    size="md"
                    fullWidth={false}
                    onClick={openAdd}
                    disabled={!selectedId || writing}
                  >
                    Add payment
                  </Button>
                </div>
              </div>

              {writeError && !dialogOpen && !confirming && !bulk && (
                <Alert tone="error">{writeError}</Alert>
              )}

              {note && <Alert tone="success">{note}</Alert>}

              {history ? (
                <DemoHistoryTable
                  payments={history.payments}
                  highlightPayeeId={matched?.payeeId ?? null}
                  highlightDates={patternDates}
                  onEdit={openEdit}
                  onDelete={setConfirming}
                  busyRowId={writing ? (editing?.id ?? confirming?.id ?? null) : null}
                />
              ) : (
                <div className="flex justify-center rounded-2xl bg-white py-12 ring-1 ring-ink-200/70">
                  <Spinner className="size-6 text-brand-600" label="Loading history" />
                </div>
              )}
            </section>

            <div className="lg:sticky lg:top-6">
              <PreviewPanel preview={preview} loading={loadingDetail} />
            </div>
          </div>
        </>
      )}

      {dialogOpen && selectedId && (
        <DemoPaymentDialog
          payees={payees}
          editing={editing}
          // A new row almost always belongs to the date being
          // simulated, so that is what it offers.
          defaultOccurredAt={at ?? new Date().toISOString()}
          maxAmountMinor={MAX_AMOUNT_MINOR}
          busy={writing}
          error={writeError}
          onCancel={() => {
            setDialogOpen(false);
            setEditing(null);
            setWriteError(null);
          }}
          onCreate={(input) => void handleCreate(input)}
          onUpdate={(changes) => void handleUpdate(changes)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          titleId="delete-demo-payment-title"
          title="Delete this demonstration payment?"
          confirmLabel="Delete"
          busy={writing}
          error={writeError}
          onCancel={() => {
            setConfirming(null);
            setWriteError(null);
          }}
          onConfirm={() => void handleDelete()}
        >
          {/* Named in full, because deleting cannot be undone. */}
          {formatAmount(confirming.amountMinor, confirming.currency, 'en')} to{' '}
          {confirming.payee.displayName} on{' '}
          {new Date(confirming.occurredAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          . This cannot be undone.
        </ConfirmDialog>
      )}

      {bulk === 'reset' && (
        <ConfirmDialog
          titleId="reset-demo-history-title"
          title="Clear this customer's demonstration history?"
          confirmLabel="Clear history"
          busy={writing}
          error={writeError}
          onCancel={() => {
            setBulk(null);
            setWriteError(null);
          }}
          onConfirm={() => void handleReset()}
        >
          {/*
            The count and the limit of the action, both stated: an admin
            should know how much goes and what is deliberately spared
            before pressing it, not afterwards.
          */}
          Deletes all {history?.payments.length ?? 0} demonstration record
          {history?.payments.length === 1 ? '' : 's'} for{' '}
          {history?.customer.fullName ?? 'this customer'}, and the seeded beneficiaries they
          belong to. Beneficiaries the customer entered themselves are left alone, and no
          assisted activity or past suggestion is touched. This cannot be undone.
        </ConfirmDialog>
      )}

      {bulk === 'restore' && (
        <ConfirmDialog
          titleId="restore-demo-history-title"
          title="Restore the seeded demonstration history?"
          confirmLabel="Restore"
          confirmVariant="primary"
          busy={writing}
          error={writeError}
          onCancel={() => {
            setBulk(null);
            setWriteError(null);
          }}
          onConfirm={() => void handleRestore()}
        >
          {/* What the fixture is, so "restored" is not a mystery. */}
          Clears the {history?.payments.length ?? 0} record
          {history?.payments.length === 1 ? '' : 's'} on file and writes the standard fixture
          back: a monthly habit due today, one recent payment to someone else, and a cluster of
          payments that is deliberately not a habit. The same nine records a freshly seeded
          machine starts with. This cannot be undone.
        </ConfirmDialog>
      )}
    </div>
  );
}

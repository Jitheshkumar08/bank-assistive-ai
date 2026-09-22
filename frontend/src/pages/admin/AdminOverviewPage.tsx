import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/types/api';
import type { AdminBranch, AdminOverview } from '@/types/admin';

/**
 * The staff screen's front page: how the service is being used, and
 * every branch with its QR code one tap away.
 */
export function AdminOverviewPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [branches, setBranches] = useState<AdminBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const [summary, list] = await Promise.all([
        adminApi.overview(signal),
        adminApi.listBranches(signal),
      ]);

      setOverview(summary);
      setBranches(list);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.isNetworkError && signal?.aborted) return;

      setError(
        caught instanceof ApiError ? caught.message : 'Could not load the branches. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);

    return () => controller.abort();
  }, [load]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? branches.filter((branch) =>
        [branch.code, branch.name, branch.city ?? ''].some((value) =>
          value.toLowerCase().includes(term),
        ),
      )
    : branches;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink-900 sm:text-3xl">
            Branches
          </h1>
          <p className="mt-1.5 text-[0.9375rem] text-ink-500">
            Add a branch, print its QR code, or take one out of service.
          </p>
        </div>

        <Link
          to="/admin/branches/new"
          className="inline-flex min-h-touch items-center gap-2 rounded-xl bg-brand-600 px-5 text-base font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(12_51_49/0.3)] transition-colors hover:bg-brand-700"
        >
          Add branch
        </Link>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Branches" value={overview?.branches.total} hint="in total" />
        <Stat label="In service" value={overview?.branches.active} hint="accepting scans" />
        <Stat label="Customers" value={overview?.customers} hint="registered" />
        <Stat label="Visits today" value={overview?.visits.today} hint="since midnight" />
      </dl>

      <section aria-labelledby="branch-list" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="branch-list" className="text-sm font-medium text-ink-900">
            All branches
          </h2>

          <label className="flex min-w-0 flex-1 justify-end">
            <span className="sr-only">Search branches</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, city or code"
              className="min-h-touch w-full max-w-xs rounded-xl bg-white px-4 text-[0.9375rem] text-ink-900 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-500/50 focus-visible:outline-none"
            />
          </label>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6 text-brand-600" label="Loading branches" />
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-ink-500 ring-1 ring-ink-200/70">
            {branches.length === 0
              ? 'No branches yet. Add the first one to generate its QR code.'
              : 'No branch matches that search.'}
          </p>
        ) : (
          <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
            {visible.map((branch) => (
              <li key={branch.id}>
                <Link
                  to={`/admin/branches/${branch.id}`}
                  className="flex min-h-touch items-center gap-4 px-4 py-3.5 transition-colors hover:bg-ink-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[0.9375rem] font-medium text-ink-900">
                        {branch.name}
                      </span>
                      {!branch.isActive && (
                        <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                          Out of service
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-ink-500">
                      {branch.code}
                      {branch.city ? ` · ${branch.city}` : ''}
                    </span>
                  </span>

                  <span className="hidden shrink-0 text-right text-sm text-ink-500 sm:block">
                    {branch.totalVisits} visit{branch.totalVisits === 1 ? '' : 's'}
                    {branch.activeVisits > 0 && (
                      <span className="block text-brand-700">{branch.activeVisits} in progress</span>
                    )}
                  </span>

                  <svg
                    className="size-4 shrink-0 text-ink-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value?: number; hint: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
      <dt className="text-xs font-medium tracking-[0.1em] text-ink-500 uppercase">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-ink-900 tabular-nums">
        {value ?? '—'}
      </dd>
      <p className="mt-0.5 text-xs text-ink-400">{hint}</p>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { BranchQr } from '@/components/admin/BranchQr';
import {
  BranchFields,
  validateBranch,
  type BranchDraft,
  type BranchFieldErrors,
} from '@/components/admin/BranchFields';
import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/types/api';
import type { AdminBranch } from '@/types/admin';

function toDraft(branch: AdminBranch): BranchDraft {
  return {
    code: branch.code,
    name: branch.name,
    city: branch.city ?? '',
    address: branch.address ?? '',
  };
}

/** One branch: its details, its QR code, and the way to retire it. */
export function AdminBranchPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [branch, setBranch] = useState<AdminBranch | null>(null);
  const [draft, setDraft] = useState<BranchDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<BranchFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: AdminBranch): void => {
    setBranch(next);
    setDraft(toDraft(next));
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        adopt(await adminApi.getBranch(id, controller.signal));
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError ? caught.message : 'Could not load that branch. Try again.',
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, [id, adopt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!draft || saving) return;

    const problems = validateBranch(draft, { requireCode: false });
    setFieldErrors(problems);

    if (Object.keys(problems).length > 0) {
      setError(null);
      setSaved(false);
      return;
    }

    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      // Only what changed: a form that resends everything it rendered
      // overwrites whatever someone else edited in the meantime.
      adopt(
        await adminApi.updateBranch(id, {
          name: draft.name.trim(),
          city: draft.city.trim(),
          address: draft.address.trim(),
        }),
      );
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function setInService(isActive: boolean): Promise<void> {
    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      adopt(await adminApi.updateBranch(id, { isActive }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change that. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setError(null);
    setSaving(true);

    try {
      await adminApi.deleteBranch(id);
      navigate('/admin', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not delete that branch. Try again.',
      );
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6 text-brand-600" label="Loading the branch" />
      </div>
    );
  }

  if (!branch || !draft) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <Alert tone="error">{error ?? 'That branch no longer exists.'}</Alert>
        <Link to="/admin" className="text-sm font-medium text-brand-700 hover:text-brand-800">
          Back to branches
        </Link>
      </div>
    );
  }

  const neverVisited = branch.totalVisits === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/admin" className="text-sm font-medium text-brand-700 hover:text-brand-800">
          Back to branches
        </Link>
        <h1 className="mt-3 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-[-0.03em] text-ink-900">
          {branch.name}
          {!branch.isActive && (
            <span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600">
              Out of service
            </span>
          )}
        </h1>
        <p className="mt-1.5 text-[0.9375rem] text-ink-500">
          {branch.totalVisits} visit{branch.totalVisits === 1 ? '' : 's'} recorded
          {branch.activeVisits > 0 ? `, ${branch.activeVisits} in progress` : ''}.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">The branch details have been saved.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <form
          className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
          onSubmit={handleSubmit}
          noValidate
        >
          <BranchFields
            draft={draft}
            errors={fieldErrors}
            disabled={saving}
            editableCode={false}
            onChange={(changes) => setDraft((current) => (current ? { ...current, ...changes } : current))}
          />

          <Button type="submit" loading={saving} fullWidth={false} className="sm:min-w-40 sm:self-start">
            {saving ? 'Saving' : 'Save changes'}
          </Button>
        </form>

        <div className="flex flex-col gap-6">
          <BranchQr branch={branch} />

          <section
            aria-labelledby="branch-service"
            className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
          >
            <h2 id="branch-service" className="text-sm font-medium text-ink-900">
              Service
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">
              {branch.isActive
                ? 'Customers can scan this branch now. Take it out of service to stop new visits without losing its history.'
                : 'Scans of this code are refused. Put it back in service when the counter reopens.'}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void setInService(!branch.isActive)}
                className="inline-flex min-h-touch items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-ink-700 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200 transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:opacity-50"
              >
                {branch.isActive ? 'Take out of service' : 'Put back in service'}
              </button>

              {/* Deleting is only ever offered before anyone has used the
                  branch: after that it is part of those visits' record. */}
              {neverVisited && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDelete()}
                  className="inline-flex min-h-touch items-center justify-center rounded-xl px-4 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
                >
                  Delete branch
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

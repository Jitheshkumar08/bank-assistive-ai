import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import {
  BranchFields,
  validateBranch,
  type BranchDraft,
  type BranchFieldErrors,
} from '@/components/admin/BranchFields';
import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/types/api';

const EMPTY: BranchDraft = { code: '', name: '', city: '', address: '' };

/** Adding a branch. Its QR code is ready on the branch's own page after. */
export function AdminNewBranchPage() {
  const navigate = useNavigate();

  const [draft, setDraft] = useState<BranchDraft>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<BranchFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submitting) return;

    const problems = validateBranch(draft, { requireCode: true });
    setFieldErrors(problems);

    if (Object.keys(problems).length > 0) {
      setError(null);
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const branch = await adminApi.createBranch({
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        // Omitted rather than sent blank: the API stores nothing for an
        // absent field, and "" is not a city.
        ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
        ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
      });

      navigate(`/admin/branches/${branch.id}`, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not add that branch. Try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <Link to="/admin" className="text-sm font-medium text-brand-700 hover:text-brand-800">
          Back to branches
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-ink-900">Add a branch</h1>
        <p className="mt-1.5 text-[0.9375rem] text-ink-500">
          The code you choose here is what the QR code carries, and what staff read out when a
          camera will not scan.
        </p>
      </div>

      <form
        className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
        onSubmit={handleSubmit}
        noValidate
      >
        {error && <Alert tone="error">{error}</Alert>}

        <BranchFields
          draft={draft}
          errors={fieldErrors}
          disabled={submitting}
          editableCode
          onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
        />

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" loading={submitting} fullWidth={false} className="sm:min-w-40">
            {submitting ? 'Adding branch' : 'Add branch'}
          </Button>
          <Link
            to="/admin"
            className="inline-flex min-h-touch items-center justify-center rounded-xl px-5 text-base font-semibold text-ink-700 transition-colors hover:bg-ink-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { QrScanner } from '@/components/scan/QrScanner';
import { contextApi } from '@/api/context.api';
import { useSession } from '@/context/useSession';
import { useVoice } from '@/context/useVoice';
import { parseQrPayload } from '@/lib/qr';
import { ApiError } from '@/types/api';
import type { Branch } from '@/types/context';

export function ScanPage() {
  const { establish } = useSession();
  const navigate = useNavigate();
  // The voice question is answered before the camera starts.
  const { needsChoice } = useVoice();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);

  const [branchCode, setBranchCode] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The camera decodes the same code many times a second. Remembering
  // the last one handled stops a single sticker producing a stream of
  // duplicate submissions and repeated error messages.
  const lastHandledRef = useRef<string | null>(null);

  // Shown as a hint so someone reading a code off a counter can check
  // they have the right branch before submitting.
  useEffect(() => {
    const controller = new AbortController();

    contextApi
      .listBranches(controller.signal)
      .then(setBranches)
      .catch(() => setBranches([]))
      .finally(() => setLoadingBranches(false));

    return () => controller.abort();
  }, []);

  const submitContext = useCallback(
    async (branch: string): Promise<void> => {
      setError(null);
      setSubmitting(true);

      try {
        // establish() moves the existing visit when there is one, so
        // scanning a second code never opens a duplicate session.
        await establish(branch.trim().toUpperCase());
        navigate('/welcome', { replace: true });
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : 'Could not confirm that branch. Try again.',
        );
        // Let the same code be tried again after a failure.
        lastHandledRef.current = null;
        setSubmitting(false);
      }
    },
    [establish, navigate],
  );

  /**
   * Handles whatever the camera decoded.
   *
   * The argument is untrusted text from a sticker on a wall. It is never
   * executed, interpreted or trusted: parseQrPayload extracts exactly
   * one code and discards everything else, and the API then decides
   * whether that code names a real branch.
   */
  const handleScan = useCallback(
    (raw: string): void => {
      if (submitting || raw === lastHandledRef.current) return;

      lastHandledRef.current = raw;

      const payload = parseQrPayload(raw);

      if (!payload) {
        setError('That code is not a valid branch code. Ask branch staff for help.');
        return;
      }

      void submitContext(payload.branch_id);
    },
    [submitting, submitContext],
  );

  function handleManualSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting) return;
    void submitContext(branchCode);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Find your branch</h1>
        <p className="mt-1 text-base text-ink-600">
          Scan the QR code displayed at your counter to get help for where you are standing.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Card className="flex flex-col gap-4">
        {submitting ? (
          <div className="flex flex-col items-center gap-3 py-10 text-brand-600">
            <Spinner className="size-8" label={null} />
            <p className="text-base text-ink-600">Checking that code…</p>
          </div>
        ) : (
          // Unmounting the scanner while submitting is what releases the
          // camera, so the indicator light goes out as soon as a code is
          // accepted rather than lingering on the welcome screen.
          <QrScanner onScan={handleScan} active={!submitting && !needsChoice} />
        )}
      </Card>

      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          onClick={() => setShowManualEntry((shown) => !shown)}
          aria-expanded={showManualEntry}
          aria-controls="manual-entry"
        >
          {showManualEntry ? 'Hide manual entry' : 'Enter the code manually instead'}
        </Button>

        {showManualEntry && (
          <Card id="manual-entry">
            <form className="flex flex-col gap-5" onSubmit={handleManualSubmit} noValidate>
              <Field
                label="Branch code"
                name="branchCode"
                placeholder="BR001"
                autoCapitalize="characters"
                autoComplete="off"
                required
                disabled={submitting}
                value={branchCode}
                onChange={(event) => setBranchCode(event.target.value)}
                hint="Printed beneath the QR code."
              />

              <Button type="submit" loading={submitting}>
                {submitting ? 'Checking' : 'Continue'}
              </Button>
            </form>
          </Card>
        )}
      </div>

      <section aria-labelledby="branch-list">
        <h2 id="branch-list" className="mb-2 text-sm font-semibold text-ink-500">
          Branches using this service
        </h2>

        {loadingBranches ? (
          <Spinner className="size-5 text-brand-600" label="Loading branches" />
        ) : branches.length === 0 ? (
          <p className="text-sm text-ink-500">Branch list unavailable right now.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-ink-600">
            {branches.map((branch) => (
              <li key={branch.id}>
                <span className="font-semibold text-ink-800">{branch.code}</span> — {branch.name}
                {branch.city && `, ${branch.city}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { QrScanner } from '@/components/scan/QrScanner';
import { contextApi } from '@/api/context.api';
import { useSession } from '@/context/useSession';
import { useVoice } from '@/context/useVoice';
import { cn } from '@/lib/cn';
import { parseQrPayload } from '@/lib/qr';
import { ApiError } from '@/types/api';
import type { Branch } from '@/types/context';

/**
 * How to scan, set beside the camera on a wide screen where there is room
 * to say it. A phone gets the key instruction inside the viewfinder.
 */
const STEPS = [
  { title: 'Find the QR code at your counter', body: 'The branch code is printed beneath it.' },
  {
    title: 'Hold it inside the frame',
    body: 'It is read automatically, so there is nothing to press.',
  },
  {
    title: 'Carry on with the assistant',
    body: 'You are guided through your task at this branch.',
  },
] as const;

/*
 * Type on this screen keeps to three weights and two greys: semibold for
 * the one heading, medium for anything that labels, regular for anything
 * that explains -- in ink-900 and ink-500. Teal is kept for the single
 * small label above the heading, so it reads as an accent, not a theme.
 */

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

  // A count rather than a flag, so asking a second time focuses again.
  const [codeFocusRequests, setCodeFocusRequests] = useState(0);
  const manualEntryRef = useRef<HTMLDivElement | null>(null);

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

  // Runs once manual entry has rendered, so the box is there to focus.
  useEffect(() => {
    if (codeFocusRequests === 0) return;

    manualEntryRef.current?.querySelector('input')?.focus();
  }, [codeFocusRequests]);

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

  /**
   * The way on from a camera that cannot be used: open manual entry and
   * go straight to the box. Opening it from its own toggle leaves focus
   * on the toggle instead, as a disclosure should.
   */
  const enterCodeInstead = useCallback((): void => {
    setShowManualEntry(true);
    setCodeFocusRequests((count) => count + 1);
  }, []);

  function handleManualSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting) return;
    void submitContext(branchCode);
  }

  return (
    <div className="lg:pt-6">
      {/* One centred column up to laptop width. From there the camera sits
          on the right, and everything about using it on the left. */}
      <div className="mx-auto grid w-full max-w-lg gap-6 lg:max-w-none lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-12 lg:gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:gap-x-16">
        <div className="lg:col-start-1 lg:row-start-1">
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">
            Check in
          </p>
          <h1 className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.035em] text-ink-900 sm:text-4xl lg:text-[2.625rem]">
            Find your branch
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-500 sm:text-[1.0625rem]">
            Scan the QR code displayed at your counter to get help for where you are standing.
          </p>

          {error && (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          )}
        </div>

        <section
          aria-label="QR code scanner"
          className="lg:col-start-2 lg:row-span-3 lg:row-start-1"
        >
          <div className="rounded-[1.75rem] bg-white p-2.5 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_24px_48px_-24px_rgb(16_24_40/0.22)] ring-1 ring-ink-200/70">
            {submitting ? (
              <CheckingCode />
            ) : (
              // Unmounting the scanner while submitting is what releases the
              // camera, so the indicator light goes out as soon as a code is
              // accepted rather than lingering on the welcome screen.
              <QrScanner
                onScan={handleScan}
                active={!submitting && !needsChoice}
                onEnterCode={enterCodeInstead}
              />
            )}

            {/* True of the scanner: frames are decoded in the browser, and
                only the branch code read from them is ever sent. */}
            <p className="flex items-start gap-2 px-2.5 pt-3 pb-1.5 text-[0.8125rem] leading-5 text-ink-500">
              <LockIcon />
              The camera only looks for the code. Video is never recorded or sent.
            </p>
          </div>
        </section>

        <div className="hidden lg:col-start-1 lg:row-start-2 lg:block">
          <h2 className="sr-only">How to scan</h2>
          <ol className="flex flex-col gap-6">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative flex gap-4">
                {/* The thread from one number down to the next. */}
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-9 -bottom-5 left-4 w-px -translate-x-1/2 bg-ink-200"
                  />
                )}
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[0.8125rem] font-medium text-ink-500 tabular-nums ring-1 ring-ink-200"
                >
                  {index + 1}
                </span>
                <div className="pt-1">
                  <p className="text-[0.9375rem] leading-6 font-medium text-ink-900">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-500">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="lg:col-start-1 lg:row-start-3">
          <div className="rounded-2xl bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
            <h2>
              <button
                type="button"
                onClick={() => setShowManualEntry((shown) => !shown)}
                aria-expanded={showManualEntry}
                aria-controls="manual-entry"
                // Named by its title alone, with the line beneath as its
                // description, so the name stays short when read out.
                aria-label="Enter the code manually"
                aria-describedby="manual-entry-description"
                className={cn(
                  'flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-ink-50 sm:px-5',
                  showManualEntry ? 'rounded-t-2xl' : 'rounded-2xl',
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-50 text-ink-600 ring-1 ring-ink-200/70"
                >
                  <KeyboardIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] leading-6 font-medium text-ink-900">
                    Enter the code manually
                  </span>
                  <span id="manual-entry-description" className="block text-sm leading-5 text-ink-500">
                    If the camera cannot read the QR code
                  </span>
                </span>
                <ChevronIcon open={showManualEntry} />
              </button>
            </h2>

            {showManualEntry && (
              <div
                id="manual-entry"
                ref={manualEntryRef}
                className="border-t border-ink-200/70 p-4 sm:p-5"
              >
                <form
                  className="flex flex-col gap-3 sm:flex-row sm:items-end"
                  onSubmit={handleManualSubmit}
                  noValidate
                >
                  <div className="min-w-0 flex-1">
                    <Field
                      label="Branch code"
                      name="branchCode"
                      placeholder="BR001"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      required
                      disabled={submitting}
                      value={branchCode}
                      onChange={(event) => setBranchCode(event.target.value)}
                      hint="Printed beneath the QR code."
                      className="font-medium tracking-[0.08em] uppercase placeholder:font-normal"
                    />
                  </div>

                  <Button type="submit" loading={submitting} className="sm:w-auto sm:min-w-32">
                    {submitting ? 'Checking' : 'Continue'}
                  </Button>
                </form>

                <section aria-labelledby="branch-list" className="mt-6">
                  <h3
                    id="branch-list"
                    className="text-xs font-medium tracking-[0.1em] text-ink-500 uppercase"
                  >
                    Branches using this service
                  </h3>

                  {loadingBranches ? (
                    <div className="mt-3">
                      <Spinner className="size-5 text-brand-600" label="Loading branches" />
                    </div>
                  ) : branches.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-500">Branch list unavailable right now.</p>
                  ) : (
                    <ul className="mt-2 max-h-60 divide-y divide-ink-100 overflow-y-auto rounded-xl ring-1 ring-ink-200/70">
                      {branches.map((branch) => (
                        <li
                          key={branch.id}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                        >
                          <span className="min-w-0 truncate text-ink-900">
                            {branch.name}
                            {branch.city && <span className="text-ink-500">, {branch.city}</span>}
                          </span>
                          <span className="shrink-0 rounded-md bg-ink-50 px-2 py-0.5 text-xs font-medium tracking-[0.06em] text-ink-600 tabular-nums ring-1 ring-ink-200/70">
                            {branch.code}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Holds the camera's place while a code is confirmed, so nothing jumps. */
function CheckingCode() {
  return (
    <div
      role="status"
      className="flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-[1.125rem] bg-ink-900 p-6 text-center text-white"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
        <Spinner className="size-6" label={null} />
      </span>
      <div>
        <p className="text-base font-medium">Checking that code…</p>
        <p className="mt-1 text-sm text-white/60">Confirming which branch you are in</p>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      className="mt-0.5 size-4 shrink-0 text-ink-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M6.5 9.5h.01M10 9.5h.01M14 9.5h.01M17.5 9.5h.01M6.5 12.5h.01M17.5 12.5h.01M9 15.5h6" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn(
        'size-5 shrink-0 text-ink-400 transition-transform duration-200',
        open && 'rotate-180',
      )}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { activitiesApi } from '@/api/activities.api';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { HAND_OVER_REQUESTS } from '@/lib/commonRequests';
import { formatAmount, isBankVerified, suggestionCopy } from '@/lib/suggestionCopy';
import type { ActivityReview } from '@/types/suggestions';

/**
 * The deterministic step between a remembered payment and the assistant.
 *
 * Everything here is plain and local: no model decides anything on this
 * screen, and nothing on it moves money. It shows what the server
 * resolved, lets the customer correct the amount, and -- only once they
 * say yes -- hands them to the existing banking assistance with that
 * request already on its way.
 *
 * The account is shown masked, because masked is all that is stored.
 */
export function ReviewActivityPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { session } = useSession();

  const language = session?.language ?? user?.preferredLanguage ?? 'en';
  const copy = suggestionCopy(language);

  const [review, setReview] = useState<ActivityReview | null>(null);
  const [rupees, setRupees] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activityId) return;

    const controller = new AbortController();

    activitiesApi
      .review(activityId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        setReview(result.review);
        setRupees(
          result.review.amountMinor === null ? '' : String(Math.round(result.review.amountMinor / 100)),
        );
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;

        setError(cause instanceof Error ? cause.message : copy.reviewTitle);
        setLoading(false);
      });

    return () => controller.abort();
  }, [activityId, copy.reviewTitle]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!activityId) return;

    setConfirming(true);
    setError(null);

    const entered = Number(rupees);
    const amountMinor =
      Number.isFinite(entered) && entered > 0 ? Math.round(entered * 100) : undefined;

    try {
      const confirmed = await activitiesApi.confirm(activityId, { amountMinor });

      // Into the EXISTING conversation, by the same door as the common
      // request tiles: a phrase the server chose, sent as a turn. No new
      // endpoint, no new workflow, nothing that executes a payment.
      navigate('/assistant', {
        state: { request: HAND_OVER_REQUESTS[confirmed.handOver.requestKey] },
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : copy.reviewTitle);
      setConfirming(false);
    }
  }, [activityId, copy.reviewTitle, navigate, rupees]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16 text-brand-600">
        <Spinner className="size-8" label={copy.reviewTitle} />
      </div>
    );
  }

  const verified = review ? isBankVerified(review.provenance) : false;

  return (
    <div className="sm:pt-4 lg:pt-10">
      <div className="mx-auto flex w-full max-w-md flex-col">
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.03em] text-ink-900 sm:text-3xl">
          {copy.reviewTitle}
        </h1>
        <p className="mt-2 text-base text-ink-500">{copy.reviewIntro}</p>

        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        {review && (
          <>
            <dl className="mt-6 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink-500">{copy.reviewPayee}</dt>
                <dd className="text-right text-base font-medium text-ink-900">
                  {review.payee?.displayName ?? '—'}
                  {!verified && (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-amber-800 uppercase ring-1 ring-amber-200">
                      {copy.demoBadge}
                    </span>
                  )}
                </dd>
              </div>

              {review.payee?.accountLast4 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-ink-500">{copy.reviewAccount}</dt>
                  {/* Masked is not a display choice: the full number is
                      not stored anywhere in this system. */}
                  <dd className="text-base text-ink-900">••••{review.payee.accountLast4}</dd>
                </div>
              )}

              {review.amountMinor !== null && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-ink-500">{copy.reviewAmount}</dt>
                  <dd className="text-base text-ink-900">
                    {formatAmount(review.amountMinor, review.currency, language)}
                  </dd>
                </div>
              )}
            </dl>

            <label className="mt-5 flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-900">{copy.reviewAmount}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={rupees}
                onChange={(event) => setRupees(event.target.value)}
                className="min-h-touch rounded-xl bg-white px-4 text-base text-ink-900 ring-1 ring-ink-200 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              />
            </label>

            <Alert tone="info" className="mt-5">
              {copy.reviewNotice}
            </Alert>

            <div className="mt-6 flex flex-col gap-2">
              <Button loading={confirming} onClick={() => void handleConfirm()}>
                {confirming ? copy.reviewConfirming : copy.reviewConfirm}
              </Button>

              <Button variant="ghost" disabled={confirming} onClick={() => navigate('/welcome')}>
                {copy.reviewBack}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

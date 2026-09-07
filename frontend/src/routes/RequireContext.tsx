import { useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useSession } from '@/context/useSession';

/**
 * Gate for screens that only make sense once branch context exists.
 *
 * The assistant must never answer without knowing which branch the
 * customer is in. Someone without context is sent to scan rather than
 * shown a half-configured screen.
 *
 * A failed lookup is handled separately from an absent visit. Bouncing
 * someone to the scan screen because the network dropped tells them
 * nothing and invites them to redo work they had already done.
 */
export function RequireContext() {
  const { hasContext, isLoading, error, refresh } = useSession();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry(): Promise<void> {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16 text-brand-600">
        <Spinner className="size-8" label="Loading your branch" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">We could not load your branch</h1>
          <p className="mt-1 text-base text-ink-600">
            Your place in the queue has not been lost. This is a connection problem, not
            something you did.
          </p>
        </div>

        <Alert tone="error">{error}</Alert>

        <Card className="flex flex-col gap-3">
          <Button onClick={() => void handleRetry()} loading={retrying}>
            {retrying ? 'Trying again' : 'Try again'}
          </Button>

          <Button variant="secondary" onClick={() => navigate('/scan')}>
            Scan a code instead
          </Button>
        </Card>

        <p className="text-center text-sm text-ink-500">
          Still stuck? Any member of branch staff can help.
        </p>
      </div>
    );
  }

  if (!hasContext) {
    return <Navigate to="/scan" replace />;
  }

  return <Outlet />;
}

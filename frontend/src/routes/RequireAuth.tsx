import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/useAuth';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Gate for signed-in routes.
 *
 * While a stored token is being checked, it renders a waiting state
 * rather than redirecting -- otherwise a refresh would bounce a
 * legitimately signed-in person to the login screen before the check
 * finishes.
 */
export function RequireAuth() {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-50 text-brand-600">
        <Spinner className="size-8" label="Checking your session" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Remembering where they were heading means a expired session
    // returns them to the same place after signing in again.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

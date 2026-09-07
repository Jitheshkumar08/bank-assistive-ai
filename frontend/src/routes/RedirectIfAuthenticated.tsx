import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/useAuth';
import { Spinner } from '@/components/ui/Spinner';

/** Keeps an already signed-in person off the login screen. */
export function RedirectIfAuthenticated() {
  const { isAuthenticated, isRestoring } = useAuth();

  if (isRestoring) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-50 text-brand-600">
        <Spinner className="size-8" label="Checking your session" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/scan" replace />;
  }

  return <Outlet />;
}

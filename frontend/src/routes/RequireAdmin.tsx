import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/useAuth';

/**
 * Gate for the staff screen.
 *
 * Sits inside RequireAuth, which has already settled whether anyone is
 * signed in, so this only has to decide whether that account is staff.
 * A customer who types the address is sent back to their own screen
 * rather than shown anything about branches.
 *
 * The real check is on the API: every admin route refuses a customer's
 * token. This is what keeps the screen from appearing at all.
 */
export function RequireAdmin() {
  const { user } = useAuth();

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/scan" replace />;
  }

  return <Outlet />;
}

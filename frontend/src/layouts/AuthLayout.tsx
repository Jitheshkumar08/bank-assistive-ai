import { Outlet } from 'react-router-dom';
import { AuthShell } from '@/components/auth/AuthShell';

/**
 * Frame for standalone public screens -- a page that does not exist, for
 * instance. Sign-in and registration have their own frame, AccountLayout,
 * which adds the toggle between them.
 */
export function AuthLayout() {
  return (
    <AuthShell>
      <div className="relative w-full max-w-md animate-rise rounded-3xl bg-white p-8 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_32px_64px_-32px_rgb(16_24_40/0.28)] ring-1 ring-ink-200/70">
        <Outlet />
      </div>
    </AuthShell>
  );
}

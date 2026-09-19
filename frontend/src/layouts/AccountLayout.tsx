import { Outlet, useLocation } from 'react-router-dom';
import { AccountToggle } from '@/components/auth/AccountToggle';
import { AuthShell } from '@/components/auth/AuthShell';

/**
 * Sign-in and registration share one frame.
 *
 * The toggle lives here rather than in either page, so it stays mounted
 * while only the form beneath it changes. That is what lets its highlight
 * slide from one side to the other instead of the whole card reloading.
 * Each form still has its own URL.
 */
export function AccountLayout() {
  const location = useLocation();

  return (
    <AuthShell showcase>
      <div className="relative w-full max-w-[26rem] lg:max-w-[34rem]">
        <div className="rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_32px_64px_-32px_rgb(16_24_40/0.28)] ring-1 ring-ink-200/70 sm:p-7">
          <AccountToggle />

          {/* Keyed by path, so switching forms replays a short entrance
              rather than swapping the content abruptly. */}
          <div key={location.pathname} className="mt-6 animate-rise">
            <Outlet />
          </div>
        </div>
      </div>
    </AuthShell>
  );
}

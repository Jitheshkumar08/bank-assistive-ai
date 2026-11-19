import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { cn } from '@/lib/cn';

/**
 * The frame around the staff screen.
 *
 * Deliberately plainer than the customer's: no branch pill, no voice.
 * Whoever is here is managing branches, not visiting one.
 */
export function AdminLayout() {
  const { user, logout } = useAuth();
  const { endSession } = useSession();
  const navigate = useNavigate();

  async function handleSignOut(): Promise<void> {
    await endSession();
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-dvh bg-ink-50">
      <a href="#admin-main" className="sr-only-focusable">
        Skip to main content
      </a>

      <header className="border-b border-ink-200/60 bg-white/80 px-5 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3">
          <NavLink to="/admin" className="flex min-w-0 items-center gap-2.5" end>
            <BrandMark size="sm" />
            <span className="truncate text-[0.95rem] font-semibold tracking-tight text-ink-900">
              Branch admin
            </span>
          </NavLink>

          <div className="flex min-w-0 items-center gap-2">
            {/*
              Development builds only. import.meta.env.DEV is false in a
              production bundle, so the link is not merely hidden -- it
              is not in the shipped JavaScript at all, which matches the
              API module not being registered there.
            */}
            {import.meta.env.DEV && (
              <NavLink
                to="/admin/demo"
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-touch shrink-0 items-center rounded-xl px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-ink-100 text-ink-900'
                      : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
                  )
                }
              >
                Personalisation
              </NavLink>
            )}

            <span className="hidden max-w-48 truncate text-sm text-ink-500 sm:block">
              {user?.email}
            </span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className={cn(
                'inline-flex min-h-touch items-center rounded-xl px-3 text-sm font-medium',
                'text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900',
              )}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main id="admin-main" className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}

import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';

const FORMS = [
  { to: '/login', label: 'Sign in' },
  { to: '/register', label: 'Create account' },
] as const;

/**
 * Switches between signing in and creating an account.
 *
 * Two links styled as a segmented control, not tabs: each form has its
 * own address, so the back button, a bookmark and a shared link all land
 * on the right one. The active link carries aria-current, which is how a
 * screen reader hears which form is open.
 *
 * Switching replaces the history entry rather than adding one -- flipping
 * back and forth should not leave a trail for the back button to walk --
 * and carries the location state across, so a customer sent here from a
 * protected screen still returns there once signed in.
 */
export function AccountToggle() {
  const location = useLocation();
  const onRegister = location.pathname.startsWith('/register');

  return (
    <nav aria-label="Account" className="relative grid grid-cols-2 rounded-xl bg-ink-100 p-1">
      {/* The sliding highlight. Positioned under the links, which sit above
          it, so it can move without either link re-rendering its text. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-white',
          'shadow-[0_1px_2px_rgb(16_24_40/0.1),0_1px_1px_rgb(16_24_40/0.06)] ring-1 ring-ink-200/50',
          'transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          onRegister ? 'translate-x-full' : 'translate-x-0',
        )}
      />

      {FORMS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          replace
          state={location.state}
          className={({ isActive }) =>
            cn(
              'relative flex h-10 items-center justify-center rounded-lg text-sm font-semibold transition-colors duration-200',
              isActive ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900',
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

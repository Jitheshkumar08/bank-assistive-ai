import { Outlet } from 'react-router-dom';

/**
 * Frame for screens shown before sign-in. Deliberately sparse: one
 * task, nothing to navigate away to.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <Outlet />
      </main>

      <footer className="pb-6 text-center text-xs text-ink-400">
        Branch assistance &middot; demonstration build
      </footer>
    </div>
  );
}

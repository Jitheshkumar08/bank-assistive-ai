import { Link, Outlet, useNavigate } from 'react-router-dom';
import { BranchBadge } from '@/components/context/BranchBadge';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useVoice } from '@/context/useVoice';
import { VoiceOptInDialog } from '@/components/voice/VoiceOptInDialog';
import { VoiceOverlay } from '@/components/voice/VoiceOverlay';

export function AppLayout() {
  const { user, logout } = useAuth();
  const { session, endSession } = useSession();
  const { needsChoice } = useVoice();
  const navigate = useNavigate();

  // The overlay is fixed, so it floats over whatever is beneath it. The
  // assistant composer sits at the very bottom of this scroll area, and
  // without reserved space the voice button would land on top of Send.
  const reserveSpaceForOverlay = !needsChoice;

  /**
   * Signing out is the one action that closes a visit. Finishing a
   * banking task never does -- the customer stays free to start another
   * request.
   */
  async function handleSignOut(): Promise<void> {
    await endSession();
    logout();
    navigate('/login', { replace: true });
  }

  return (
    // h-dvh, not min-h-dvh: the conversation screen needs a bounded
    // height so its message list can scroll inside itself and keep the
    // composer reachable. Scrolling moves from the page to <main>, which
    // the other screens handle identically because the header is fixed
    // either way.
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-50">
      <a href="#main" className="sr-only-focusable">
        Skip to main content
      </a>

      <header className="z-10 shrink-0 bg-brand-600 text-white shadow-sm">
        <div className="mx-auto flex w-full max-w-2xl items-start justify-between gap-4 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight">
              {user ? user.fullName : 'Banking Assistant'}
            </p>
            <BranchBadge
              branchName={session ? session.branch.name : 'Scan a code to begin'}
              city={session?.branch.city}
              className="mt-1 text-white/90"
            />
          </div>

          <div className="flex shrink-0 items-center">
            <Link
              to="/settings"
              className="min-h-touch flex items-center rounded-xl px-3 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10 active:bg-white/20"
            >
              Settings
            </Link>

            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="min-h-touch shrink-0 rounded-xl px-3 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10 active:bg-white/20"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main
        id="main"
        className={`mx-auto flex w-full min-h-0 max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-5 pt-6 ${
          reserveSpaceForOverlay ? 'pb-32' : 'pb-6'
        }`}
      >
        <Outlet />
      </main>

      {/* Both are overlays, and only one is ever visible: the dialog
          shows while the choice is unset, the corner control once it is
          settled. Neither belongs in the page flow -- the question used
          to sit at the top of every screen until it was answered, which
          read as nagging rather than asking. */}
      <VoiceOptInDialog />
      <VoiceOverlay />
    </div>
  );
}

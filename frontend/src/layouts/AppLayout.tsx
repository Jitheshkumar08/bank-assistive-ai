import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Outlet, useMatches, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { BranchBadge } from '@/components/context/BranchBadge';
import { AccountMenu } from '@/components/navigation/AccountMenu';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useVoice } from '@/context/useVoice';
import { VoiceOptInDialog } from '@/components/voice/VoiceOptInDialog';
import { VoiceOverlay } from '@/components/voice/VoiceOverlay';
import { cn } from '@/lib/cn';

/**
 * Layout options a route can set as its `handle`.
 *
 * Most signed-in screens are a single reading column. A screen that sets
 * things side by side on a wide display asks for more room here, rather
 * than fighting the column it would otherwise be placed in.
 */
export interface AppRouteHandle {
  width?: 'wide';
  /**
   * A conversation. Its composer holds the microphone, so the floating one
   * is not shown, and the composer sits near the bottom of the screen
   * rather than above space kept clear for that button.
   */
  chat?: boolean;
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { session, endSession } = useSession();
  const { isEnabled: voiceOn } = useVoice();
  const navigate = useNavigate();

  const handles = useMatches().map((match) => match.handle as AppRouteHandle | undefined);
  const isWide = handles.some((handle) => handle?.width === 'wide');
  const isChat = handles.some((handle) => handle?.chat === true);

  // The floating microphone covers whatever is beneath it, and only exists
  // while voice is on and the screen is not a conversation. Space is kept
  // clear under the page so it can never cover the last of the content.
  const reserveSpaceForOverlay = voiceOn && !isChat;

  // <main> keeps room for a scrollbar on both sides, so its page stays
  // centred whether or not it scrolls. The header pads itself by the same
  // amount to keep its edges over the page's. It is measured, rather than
  // the header being made a scroll container too, because a scroll
  // container would clip the account menu that drops out of it.
  const mainRef = useRef<HTMLElement | null>(null);
  const [scrollbarGutter, setScrollbarGutter] = useState(0);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const measure = (): void => setScrollbarGutter((main.offsetWidth - main.clientWidth) / 2);

    measure();
    // Zooming changes a scrollbar's width in CSS pixels, and fires resize.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

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
    <div
      className="flex h-dvh flex-col overflow-hidden bg-ink-50"
      style={{ '--main-gutter': `${scrollbarGutter}px` } as CSSProperties}
    >
      <a href="#main" className="sr-only-focusable">
        Skip to main content
      </a>

      <header className="relative z-20 shrink-0 border-b border-ink-200/60 bg-white/80 px-[calc(1.25rem_+_var(--main-gutter))] backdrop-blur-xl backdrop-saturate-150 sm:px-[calc(2rem_+_var(--main-gutter))]">
        {/* As wide as the widest screen, so nothing in it moves between
            screens of different widths. Three columns from a tablet up,
            with the branch held in the true centre. */}
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark size="sm" />
            <span className="hidden truncate text-[0.95rem] font-semibold tracking-tight text-ink-900 sm:block">
              Banking Assistant
            </span>
          </div>

          <div className="flex min-w-0 flex-1 justify-center">
            <BranchBadge
              branchName={session ? session.branch.name : 'Scan a code to begin'}
              city={session?.branch.city}
              active={Boolean(session)}
            />
          </div>

          <div className="flex justify-end">
            {user && (
              <AccountMenu
                name={user.fullName}
                email={user.email}
                onSignOut={() => void handleSignOut()}
              />
            )}
          </div>
        </div>
      </header>

      <main
        id="main"
        ref={mainRef}
        className={cn(
          // Full width, so the scrollbar sits at the edge of the window
          // rather than beside a centred column. The page -- main's one
          // direct child -- is centred at the width its route asks for.
          'flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-5 sm:px-8',
          '[scrollbar-gutter:stable_both-edges]',
          '*:mx-auto *:w-full',
          isWide ? '*:max-w-5xl' : '*:max-w-2xl',
          isChat
            ? 'pt-1 pb-3 sm:pt-4 sm:pb-6'
            : cn('pt-6', reserveSpaceForOverlay ? 'pb-32' : 'pb-6'),
        )}
      >
        <Outlet />
      </main>

      {/* The dialog shows while the voice choice is unset; the floating
          microphone once voice is on, everywhere except a conversation,
          whose composer carries its own. Neither belongs in the page flow
          -- the question used to sit at the top of every screen until it
          was answered, which read as nagging rather than asking. */}
      <VoiceOptInDialog />
      {!isChat && <VoiceOverlay />}
    </div>
  );
}

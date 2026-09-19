import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useVoice } from '@/context/useVoice';
import { cn } from '@/lib/cn';

interface AccountMenuProps {
  name: string;
  email: string;
  onSignOut: () => void;
}

/** Up to two letters for the avatar: first and last name, or the one name. */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  // Array.from rather than indexing, so a name that starts with a
  // character outside the basic plane is not cut in half.
  const first = (word: string): string => Array.from(word)[0] ?? '';
  const letters =
    words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);

  return letters.toLocaleUpperCase();
}

const ITEM =
  'flex min-h-touch w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:-outline-offset-2';

/**
 * The signed-in customer's own controls, behind their initials.
 *
 * A disclosure rather than an ARIA menu: the panel follows its button in
 * the page, so Tab walks straight into it, and what it holds is a switch,
 * a link and a button that behave exactly as they look.
 */
export function AccountMenu({ name, email, onSignOut }: AccountMenuProps) {
  const { isEnabled: voiceOn, enable, disable } = useVoice();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const voiceHintId = useId();
  const { pathname } = useLocation();

  // Arriving on another screen -- usually by choosing Settings -- closes it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;

      setOpen(false);
      // Back to where the customer was, rather than lost at the top.
      buttonRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const letters = initials(name);

  return (
    <div
      ref={containerRef}
      className="relative"
      // Tabbing on past the last item closes the panel. Only when focus is
      // actually going somewhere: Safari moves no focus when a button is
      // clicked, and closing on that would swallow the click itself.
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        aria-controls={panelId}
        // One label at every width. Built from separate hidden spans, the
        // pieces ran together when read out ("forDemo Customer").
        aria-label={`Account menu for ${name}`}
        className="flex min-h-touch items-center gap-2.5 rounded-full p-1.5 transition-colors hover:bg-ink-100/80 aria-expanded:bg-ink-100/80 md:pr-3"
      >
        <Avatar letters={letters} />
        <span className="hidden max-w-40 truncate text-sm font-medium text-ink-800 md:block">
          {name}
        </span>
        <svg
          className={cn(
            'hidden size-4 shrink-0 text-ink-400 transition-transform duration-200 md:block',
            open && 'rotate-180',
          )}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-30 mt-2 w-72 origin-top-right animate-pop rounded-2xl bg-white p-1.5 shadow-[0_20px_48px_-16px_rgb(16_24_40/0.3)] ring-1 ring-ink-200/70"
        >
          <div className="flex items-center gap-3 px-3 pt-2.5 pb-3">
            <Avatar letters={letters} large />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900">{name}</p>
              <p className="truncate text-[0.8125rem] text-ink-500">{email}</p>
            </div>
          </div>

          <div className="mx-1.5 mb-1.5 h-px bg-ink-100" />

          {/* The same choice the first-visit dialog asks for, kept within
              reach. Turning it on happens inside this tap, which is also
              what lets the browser play the spoken replies. */}
          <button
            type="button"
            role="switch"
            aria-checked={voiceOn}
            aria-label="Voice assistance"
            aria-describedby={voiceHintId}
            onClick={voiceOn ? disable : enable}
            className={cn(ITEM, 'py-2 text-ink-700 hover:bg-ink-50 hover:text-ink-900')}
          >
            <VoiceIcon />
            <span className="min-w-0 flex-1">
              <span className="block leading-5">Voice assistance</span>
              <span id={voiceHintId} className="block text-xs leading-4 font-normal text-ink-500">
                Talk to the assistant and hear replies
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200',
                voiceOn ? 'bg-brand-600' : 'bg-ink-200',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(16_24_40/0.25)] transition-transform duration-200',
                  voiceOn && 'translate-x-4',
                )}
              />
            </span>
          </button>

          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className={cn(ITEM, 'text-ink-700 hover:bg-ink-50 hover:text-ink-900')}
          >
            <SettingsIcon />
            Settings
          </Link>

          <div className="mx-1.5 my-1.5 h-px bg-ink-100" />

          <button
            type="button"
            onClick={onSignOut}
            className={cn(ITEM, 'text-ink-700 hover:bg-danger-50 hover:text-danger-700')}
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ letters, large = false }: { letters: string; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        'bg-linear-to-br from-brand-400 to-brand-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]',
        large ? 'size-10 text-sm' : 'size-9 text-[0.8125rem]',
      )}
    >
      {letters}
    </span>
  );
}

const ICON = 'size-[1.125rem] shrink-0 opacity-70';

function VoiceIcon() {
  return (
    <svg
      className={ICON}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      className={ICON}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      className={ICON}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3" />
      <path d="M16 16l4-4-4-4M20 12H9" />
    </svg>
  );
}

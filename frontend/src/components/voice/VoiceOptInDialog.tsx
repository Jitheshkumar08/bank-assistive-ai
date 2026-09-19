import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { useVoice } from '@/context/useVoice';

/** Everything inside the panel that a Tab press can land on. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Asks once, on arrival, whether the customer wants voice assistance.
 *
 * A modal rather than an inline card. The question needs answering once
 * and then never again, and a card sitting in the page flow reappeared
 * on every screen until it was answered -- which read as the app nagging
 * rather than asking.
 *
 * Every way out of this dialog is a real answer:
 *
 *   Enable voice        voice on
 *   Continue with text  voice off
 *   close / Escape      voice off, reachable again from the toggle
 *
 * Nothing leaves the preference unset, because an unanswered question
 * would simply be asked again on the next screen.
 */
export function VoiceOptInDialog() {
  const { needsChoice, enable, disable } = useVoice();

  const panelRef = useRef<HTMLDivElement | null>(null);

  const dismiss = useCallback(() => {
    // Closing is an answer: no voice for now. The toggle in the corner
    // is how it comes back, so nothing is lost by declining here.
    disable();
  }, [disable]);

  // Focus moves into the dialog when it opens. Without this a keyboard
  // or screen-reader user is left behind on the page underneath, tabbing
  // through content the dialog is covering.
  useEffect(() => {
    if (!needsChoice) return;

    panelRef.current?.focus();
  }, [needsChoice]);

  useEffect(() => {
    if (!needsChoice) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }

      if (event.key !== 'Tab') return;

      // Keep Tab inside the dialog. A modal you can tab out of is a
      // modal that only looks like one.
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [needsChoice, dismiss]);

  if (!needsChoice) return null;

  return (
    <div
      // z-30: above the page, below nothing else -- the voice overlay is
      // hidden while this is open, so they can never overlap.
      className="fixed inset-0 z-30 flex animate-fade items-center justify-center bg-ink-900/50 p-5 backdrop-blur-[3px]"
      // Clicking the backdrop dismisses, the way every other dialog
      // behaves. Guarded on the target so a click inside the panel that
      // bubbles up here does not close it.
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-opt-in-title"
        aria-describedby="voice-opt-in-description"
        tabIndex={-1}
        className="relative w-full max-w-[26rem] animate-rise rounded-3xl bg-white p-6 shadow-[0_24px_64px_-16px_rgb(16_24_40/0.4)] ring-1 ring-ink-900/5 outline-none sm:p-7"
      >
        <div className="flex items-center justify-between">
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"
          >
            <MicIcon />
          </span>

          {/* First in the panel, so Tab wraps from the last answer back
              to here rather than out to the page behind. */}
          <button
            type="button"
            onClick={dismiss}
            // Says what it does, not what it looks like. "Close" alone
            // leaves a screen-reader user guessing what closing means.
            aria-label="Close, and continue without voice"
            className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            <svg
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <h2
          id="voice-opt-in-title"
          className="mt-5 text-xl leading-snug font-semibold tracking-[-0.02em] text-ink-900"
        >
          Would you like voice assistance?
        </h2>

        {/* The microphone is opened only by pressing the voice control --
            enabling voice never starts a recording -- so this is the
            promise the dialog can actually keep. */}
        <p id="voice-opt-in-description" className="mt-2 text-[0.95rem] leading-relaxed text-ink-600">
          Speak to the assistant instead of typing, and hear its replies read aloud. Your microphone
          only turns on when you press the voice button.
        </p>

        <div className="mt-6 flex flex-col gap-2.5">
          <Button onClick={enable}>Enable voice</Button>
          <Button variant="secondary" onClick={disable}>
            Continue with text
          </Button>
        </div>

        <p className="mt-4 text-center text-[0.8125rem] leading-5 text-ink-500">
          You can turn voice on or off at any time from your account menu.
        </p>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      className="size-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

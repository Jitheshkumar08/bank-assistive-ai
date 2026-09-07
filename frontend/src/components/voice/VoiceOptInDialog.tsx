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
 *   Enable Voice        voice on
 *   Continue with Text  voice off
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
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink-900/60 p-5"
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
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl outline-none"
      >
        <button
          type="button"
          onClick={dismiss}
          // Says what it does, not what it looks like. "Close" alone
          // leaves a screen-reader user guessing what closing means.
          aria-label="Close, and continue without voice"
          className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
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

        <h2 id="voice-opt-in-title" className="pr-10 text-lg font-bold text-ink-900">
          Would you like Voice Assistance?
        </h2>

        <p id="voice-opt-in-description" className="mt-2 text-base text-ink-700">
          You can speak to the assistant instead of typing, and have replies read aloud. Your
          microphone is only used while you are holding the voice button.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={enable}>Enable Voice</Button>
          <Button variant="secondary" onClick={disable}>
            Continue with Text
          </Button>
        </div>
      </div>
    </div>
  );
}

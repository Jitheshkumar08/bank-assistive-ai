import { cn } from '@/lib/cn';
import { useVoice } from '@/context/useVoice';
import type { VoiceActivity } from '@/types/voice';

/** What the microphone button does next, and what to call it. */
const ACTION_LABEL: Record<VoiceActivity, string> = {
  idle: 'Start voice input',
  listening: 'Stop listening',
  processing: 'Sending what you said',
  speaking: 'Stop the assistant speaking',
};

/** Spoken by the live region. Terse on purpose -- see the note below. */
const ACTIVITY_ANNOUNCEMENT: Record<VoiceActivity, string> = {
  idle: '',
  listening: 'Listening',
  processing: 'Sending',
  speaking: 'Speaking',
};

function MicOffIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      className="size-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The always-available voice control.
 *
 * Fixed to the bottom-right thumb zone so it is reachable one-handed on
 * a tall phone, and present on every signed-in screen so the customer
 * can turn voice on or off at any point without hunting for a settings
 * page.
 *
 * Presentation only. It does not touch the microphone itself -- pressing
 * it moves the voice state machine, and VoiceProvider owns capture.
 */
export function VoiceOverlay() {
  const {
    preference,
    isEnabled,
    activity,
    micStatus,
    micMessage,
    retryMicrophone,
    speechError,
    startListening,
    stopListening,
    enable,
    disable,
    reset,
  } = useVoice();

  // While the customer has not answered the opt-in card, that card is
  // the affordance. Two competing prompts would be noise.
  if (preference === 'unset') return null;

  const isBusy = activity === 'processing' || activity === 'speaking';
  const hasMicProblem =
    micStatus === 'denied' || micStatus === 'unavailable' || micStatus === 'error';

  function handleMicPress(): void {
    if (activity === 'idle') {
      startListening();
      return;
    }

    if (activity === 'listening') {
      // A deliberate stop keeps the recording; only cancelling throws it
      // away.
      stopListening();
      return;
    }

    // Processing or speaking: one press returns to rest.
    reset();
  }

  return (
    <div
      className={cn(
        // Fixed, so a long conversation can never scroll it away. The
        // layout reserves matching space so it cannot cover the composer.
        'fixed right-4 bottom-4 z-20 flex flex-col items-end gap-2',
        // body padding does not reach a fixed element, so the home
        // indicator has to be cleared here.
        'pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]',
      )}
    >
      {/*
        Announcements live inside the fixed container so this absolutely
        positioned element is contained by it. Left in normal flow it
        would resolve against the document and stretch the page, which is
        how a fixed header was once scrolled off screen.
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {ACTIVITY_ANNOUNCEMENT[activity]}
      </p>

      {isEnabled && hasMicProblem && micMessage && (
        <div
          role="alert"
          className="max-w-[16rem] rounded-xl border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700 shadow-lg"
        >
          <p>{micMessage}</p>

          {/* A missing microphone cannot be retried into existence; a
              refused or busy one can. */}
          {micStatus !== 'unavailable' && (
            <button
              type="button"
              onClick={retryMicrophone}
              className="mt-2 min-h-touch font-semibold text-brand-700 underline"
            >
              Try the microphone again
            </button>
          )}
        </div>
      )}

      {isEnabled && speechError && (
        <p
          // status, not alert: the written reply is already on screen, so
          // a silent answer is a degraded experience rather than a
          // failure worth interrupting anyone for.
          role="status"
          className="max-w-[16rem] rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm text-ink-600 shadow-lg"
        >
          {speechError}
        </p>
      )}

      {isEnabled && activity !== 'idle' && (
        <span
          // Visual echo of the same state. aria-hidden so the live region
          // above is the single source of announcements rather than two
          // regions talking over each other.
          aria-hidden="true"
          className="rounded-full bg-ink-900/85 px-3 py-1 text-sm font-semibold text-white shadow-lg"
        >
          {ACTIVITY_ANNOUNCEMENT[activity]}
        </span>
      )}

      {isEnabled ? (
        <>
          <button
            type="button"
            onClick={handleMicPress}
            aria-label={ACTION_LABEL[activity]}
            aria-busy={isBusy || undefined}
            className={cn(
              'flex size-14 items-center justify-center rounded-full shadow-lg transition-colors',
              activity === 'listening'
                ? 'bg-danger-600 text-white hover:bg-danger-700'
                : 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
            )}
          >
            <MicIcon />
          </button>

          {/* An icon, not a sentence. The customer answered the question
              once; from here on this is a switch they glance at, and a
              wide text button in the thumb zone competes with the
              control that matters. */}
          <button
            type="button"
            onClick={disable}
            aria-label="Turn voice off"
            className="flex size-10 items-center justify-center rounded-full bg-white/95 text-ink-600 shadow-lg transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <MicOffIcon />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={enable}
          aria-label="Turn voice on"
          className="flex size-12 items-center justify-center rounded-full bg-white/95 text-brand-700 shadow-lg transition-colors hover:bg-brand-50"
        >
          <MicIcon />
        </button>
      )}
    </div>
  );
}

import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
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

function MicIcon() {
  return (
    <svg
      className="size-6"
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

function StopIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

/**
 * The microphone: one button, one tap at a time.
 *
 * Tap to talk, tap again to send. While a reply is being fetched or read
 * out, the same tap stops it. Whether voice is on at all is a setting
 * rather than something to reach for mid-visit, so that switch lives in
 * the account menu and this button only exists while voice is on.
 *
 * Fixed to the bottom-right thumb zone so it is reachable one-handed on a
 * tall phone. Presentation only: it moves the voice state machine, and
 * VoiceProvider owns the microphone itself.
 */
export function VoiceOverlay() {
  const {
    isEnabled,
    activity,
    micStatus,
    micMessage,
    retryMicrophone,
    speechError,
    startListening,
    stopListening,
    reset,
  } = useVoice();

  if (!isEnabled) return null;

  const isListening = activity === 'listening';
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
        'fixed right-5 bottom-5 z-20 flex flex-col items-end gap-2.5',
        // body padding does not reach a fixed element, so the home
        // indicator has to be cleared here.
        'pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]',
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

      {hasMicProblem && micMessage && (
        <div
          role="alert"
          className="w-72 rounded-2xl bg-white p-4 text-sm leading-relaxed text-ink-700 shadow-[0_16px_40px_-12px_rgb(16_24_40/0.3)] ring-1 ring-danger-500/25"
        >
          <p>{micMessage}</p>

          {/* A missing microphone cannot be retried into existence; a
              refused or busy one can. */}
          {micStatus !== 'unavailable' && (
            <button
              type="button"
              onClick={retryMicrophone}
              className="mt-1 inline-flex min-h-touch items-center font-semibold text-brand-700 transition-colors hover:text-brand-800"
            >
              Try the microphone again
            </button>
          )}
        </div>
      )}

      {speechError && (
        <p
          // status, not alert: the written reply is already on screen, so
          // a silent answer is a degraded experience rather than a
          // failure worth interrupting anyone for.
          role="status"
          className="max-w-72 rounded-2xl bg-white px-4 py-3 text-sm leading-relaxed text-ink-600 shadow-[0_16px_40px_-12px_rgb(16_24_40/0.3)] ring-1 ring-ink-200/70"
        >
          {speechError}
        </p>
      )}

      <div className="flex items-center gap-3">
        {activity !== 'idle' && (
          <span
            // Visual echo of the same state. aria-hidden so the live region
            // above is the single source of announcements rather than two
            // regions talking over each other.
            aria-hidden="true"
            className="flex items-center gap-2 rounded-full bg-ink-900/90 py-1.5 pr-3.5 pl-3 text-[0.8125rem] font-medium text-white shadow-lg backdrop-blur-md"
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                isListening ? 'animate-pulse bg-danger-500' : 'bg-brand-300',
              )}
            />
            {ACTIVITY_ANNOUNCEMENT[activity]}
          </span>
        )}

        <button
          type="button"
          onClick={handleMicPress}
          aria-label={ACTION_LABEL[activity]}
          aria-busy={isBusy || undefined}
          className={cn(
            'relative flex size-14 items-center justify-center rounded-full text-white',
            'shadow-[0_12px_28px_-8px_rgb(12_51_49/0.55),inset_0_1px_0_rgb(255_255_255/0.18)]',
            'transition-[background-color,scale] duration-150 active:scale-95',
            isListening
              ? 'bg-danger-600 hover:bg-danger-700'
              : isBusy
                ? 'bg-ink-900 hover:bg-ink-800'
                : 'bg-brand-600 hover:bg-brand-700',
          )}
        >
          {/* A slow ring while the microphone is open, so recording is
              obvious at a glance. Hidden for reduced motion. */}
          {isListening && (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-ping rounded-full bg-danger-500/35 motion-reduce:hidden"
            />
          )}

          <span className="relative">
            {activity === 'processing' ? (
              <Spinner className="size-6" label={null} />
            ) : isListening || activity === 'speaking' ? (
              <StopIcon />
            ) : (
              <MicIcon />
            )}
          </span>
        </button>
      </div>
    </div>
  );
}

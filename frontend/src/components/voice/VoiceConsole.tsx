import { Spinner } from '@/components/ui/Spinner';
import type { VoiceContextValue } from '@/context/VoiceContext';
import { cn } from '@/lib/cn';
import type { VoiceActivity } from '@/types/voice';
import { VoiceOrb, type OrbState } from './VoiceOrb';

interface VoiceConsoleProps {
  voice: VoiceContextValue;
  /** A typed turn is with the assistant. Voice turns show as 'processing' already. */
  isSending: boolean;
  /** The visit is over: nothing can be started. */
  ended: boolean;
  /** The assistant's latest reply, shown so it can be read when it cannot be heard. */
  lastReply: string | null;
  /** What the customer last said or typed, as the assistant received it. */
  lastHeard: string | null;
  onHelp: () => void;
  /** Any press here counts as the customer doing something. */
  onActivity?: () => void;
  variant?: 'hero' | 'compact';
  className?: string;
}

/** What the microphone button does next. Matches the composer's labels. */
const MIC_LABEL: Record<VoiceActivity, string> = {
  idle: 'Start voice input',
  listening: 'Stop listening',
  processing: 'Sending what you said',
  speaking: 'Stop the assistant speaking',
};

/** Announced once per change by the single live region below. */
const ANNOUNCEMENT: Record<VoiceActivity, string> = {
  idle: '',
  listening: 'Listening',
  processing: 'Sending',
  speaking: 'Speaking',
};

const STATUS: Record<OrbState, string> = {
  off: 'Voice is off. Turn it on to talk to the assistant, or type below.',
  idle: 'Tap the microphone and tell me what you need.',
  listening: 'Listening… I will send it when you stop talking.',
  processing: 'Working on it…',
  speaking: 'Speaking…',
  error: '',
};

/**
 * The voice-first controls: the orb, what it is doing, and the four things
 * a customer may want to do about it -- talk, hear the reply again, ask for
 * help, stop.
 *
 * Presentation only. VoiceProvider owns the microphone and playback; this
 * reads its state and calls its actions, so what is shown is always what
 * is happening. Nothing here starts listening by itself.
 */
export function VoiceConsole({
  voice,
  isSending,
  ended,
  lastReply,
  lastHeard,
  onHelp,
  onActivity,
  variant = 'compact',
  className,
}: VoiceConsoleProps) {
  const { activity, isEnabled, micStatus, micMessage, speechError } = voice;
  const hero = variant === 'hero';

  const micProblem =
    isEnabled && (micStatus === 'denied' || micStatus === 'unavailable' || micStatus === 'error')
      ? micMessage
      : null;

  const orbState: OrbState = !isEnabled
    ? 'off'
    : micProblem
      ? 'error'
      : activity === 'idle' && isSending
        ? 'processing'
        : activity;

  const isListening = activity === 'listening';
  const canReplay = isEnabled && Boolean(lastReply) && activity === 'idle' && !isSending && !ended;

  function press(action: () => void): void {
    onActivity?.();
    action();
  }

  function handleMicPress(): void {
    if (activity === 'idle') voice.startListening();
    else if (isListening) voice.stopListening();
    else voice.reset();
  }

  return (
    <section
      aria-label="Voice assistant"
      className={cn(
        'rounded-3xl bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70',
        hero ? 'flex flex-col items-center gap-4 px-5 py-6 text-center' : 'mb-2 px-4 py-3',
        className,
      )}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {isEnabled ? ANNOUNCEMENT[activity] : ''}
      </p>

      <div className={cn('flex items-center gap-3', hero && 'flex-col gap-4')}>
        <VoiceOrb state={orbState} readLevel={voice.readMicLevel} size={hero ? 'hero' : 'compact'} />

        <div className={cn('min-w-0 flex-1', hero && 'max-w-xs')}>
          <p
            data-testid="voice-status"
            className={cn('text-[0.9375rem] font-medium text-ink-800', hero && 'text-base')}
          >
            {micProblem ?? STATUS[orbState]}
          </p>

          {!hero && (lastHeard || lastReply) && (
            // The newest exchange at a glance; the full transcript is the
            // conversation below, which is what screen readers follow.
            <div aria-hidden="true" className="mt-0.5 space-y-0.5 text-[0.8125rem] leading-snug">
              {lastHeard && (
                <p className="truncate text-ink-500">
                  <span className="font-medium text-ink-600">You: </span>
                  {lastHeard}
                </p>
              )}
              {lastReply && !speechError && (
                <p className="line-clamp-2 text-ink-600">
                  <span className="font-medium text-ink-700">Assistant: </span>
                  {lastReply}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {micProblem && voice.micStatus !== 'unavailable' && (
        <div role="alert" className="mt-2 text-sm text-danger-700">
          <button
            type="button"
            onClick={() => press(voice.retryMicrophone)}
            className="inline-flex min-h-10 items-center font-semibold underline-offset-2 hover:underline"
          >
            Try the microphone again
          </button>
        </div>
      )}

      {isEnabled && speechError && (
        // The text alternative: when the reply could not be heard, it is
        // shown here in full rather than only pointed at.
        <div
          role="status"
          className="mt-2 rounded-2xl bg-ink-50 px-3.5 py-2.5 text-left text-sm leading-relaxed text-ink-700 ring-1 ring-ink-200/70"
        >
          <p className="text-ink-500">{speechError}</p>
          {lastReply && <p className="mt-1 text-ink-900">{lastReply}</p>}
        </div>
      )}

      <div
        className={cn(
          'flex flex-wrap items-center gap-2',
          hero ? 'justify-center' : 'mt-3',
        )}
      >
        {isEnabled ? (
          <button
            type="button"
            onClick={() => press(handleMicPress)}
            disabled={ended}
            aria-label={MIC_LABEL[activity]}
            aria-pressed={isListening}
            aria-busy={activity === 'processing' || undefined}
            className={cn(
              'inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-[0.9375rem] font-semibold text-white',
              'transition-[background-color,scale] duration-150 active:scale-95 disabled:opacity-50',
              isListening
                ? 'bg-danger-600 hover:bg-danger-700'
                : activity === 'idle'
                  ? 'bg-brand-600 hover:bg-brand-700'
                  : 'bg-ink-900 hover:bg-ink-800',
            )}
          >
            {activity === 'processing' ? (
              <Spinner className="size-5" label={null} />
            ) : (
              <span aria-hidden="true">{activity === 'idle' ? <MicIcon /> : <StopIcon />}</span>
            )}
            <span aria-hidden="true">
              {activity === 'idle' ? 'Speak' : isListening ? 'Send' : 'Stop'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => press(voice.enable)}
            disabled={ended}
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-600 px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            <span aria-hidden="true">
              <MicIcon />
            </span>
            Turn on voice
          </button>
        )}

        <button
          type="button"
          onClick={() => press(() => void voice.speak(lastReply ?? ''))}
          disabled={!canReplay}
          aria-label="Replay the last reply"
          className={SECONDARY}
        >
          <span aria-hidden="true">
            <ReplayIcon />
          </span>
          <span aria-hidden="true">Replay</span>
        </button>

        <button
          type="button"
          onClick={() => press(onHelp)}
          disabled={ended || isSending}
          aria-label="Help with this step"
          className={SECONDARY}
        >
          <span aria-hidden="true">?</span>
          <span aria-hidden="true">Help</span>
        </button>

        <button
          type="button"
          onClick={() => press(voice.reset)}
          disabled={activity === 'idle'}
          aria-label="Stop"
          className={SECONDARY}
        >
          <span aria-hidden="true">
            <StopIcon />
          </span>
          <span aria-hidden="true">Stop</span>
        </button>
      </div>
    </section>
  );
}

const SECONDARY =
  'inline-flex min-h-12 items-center gap-1.5 rounded-full bg-white px-4 text-[0.9375rem] font-semibold text-ink-800 ring-1 ring-ink-200 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-45';

function MicIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="3" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

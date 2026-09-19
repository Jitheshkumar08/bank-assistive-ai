import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import type { VoiceContextValue } from '@/context/VoiceContext';
import { cn } from '@/lib/cn';
import type { VoiceActivity } from '@/types/voice';

interface ComposerProps {
  onSend: (content: string) => void;
  isSending: boolean;
  /**
   * Voice controls, when a voice provider is present. While voice is on,
   * the microphone lives here beside the text rather than floating over
   * the conversation.
   */
  voice?: VoiceContextValue | null;
}

/** About five lines. Past that the box scrolls instead of growing. */
const MAX_INPUT_HEIGHT = 136;

/** What the microphone button does next. */
const MIC_LABEL: Record<VoiceActivity, string> = {
  idle: 'Start voice input',
  listening: 'Stop listening',
  processing: 'Sending what you said',
  speaking: 'Stop the assistant speaking',
};

/** Read out by the live region as a voice turn moves along. */
const ANNOUNCEMENT: Record<VoiceActivity, string> = {
  idle: '',
  listening: 'Listening',
  processing: 'Sending',
  speaking: 'Speaking',
};

const ROUND_BUTTON =
  'relative flex size-12 shrink-0 items-center justify-center rounded-full transition-[background-color,color,scale] duration-150 active:scale-95';

/**
 * Where the customer types, or talks.
 *
 * One rounded box and one round button, the way a messaging app works:
 * the button is Send once something is typed, and -- with voice on -- the
 * microphone while the box is empty.
 */
export function Composer({ onSend, isSending, voice }: ComposerProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasSending = useRef(false);

  const hasDraft = draft.trim().length > 0;
  const canSend = hasDraft && !isSending;

  const voiceOn = Boolean(voice?.isEnabled);
  const activity: VoiceActivity = voice?.activity ?? 'idle';
  const isListening = activity === 'listening';
  // A spoken turn in progress replaces the text box with its status. A
  // reply being read out does not: the customer may already be typing.
  const isVoiceTurn = voiceOn && (isListening || activity === 'processing');
  const showMicrophone = voiceOn && (!hasDraft || isVoiceTurn || activity === 'speaking');

  const micProblem =
    voiceOn &&
    voice &&
    (voice.micStatus === 'denied' || voice.micStatus === 'unavailable' || voice.micStatus === 'error')
      ? voice.micMessage
      : null;

  /**
   * Return focus to the text box once a reply lands.
   *
   * Only when focus is nowhere useful -- on the body, or on the Send
   * button that has just gone quiet. If the customer has deliberately
   * tabbed somewhere else, moving them would be worse than leaving them.
   */
  useEffect(() => {
    const finishedSending = wasSending.current && !isSending;
    wasSending.current = isSending;

    if (!finishedSending) return;

    const active = document.activeElement;
    const focusIsIdle = active === null || active === document.body || active?.tagName === 'BUTTON';

    if (focusIsIdle) inputRef.current?.focus();
  }, [isSending]);

  // Grows with what is typed, up to about five lines, then scrolls.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft, isVoiceTurn]);

  function submit(): void {
    if (!canSend) return;

    onSend(draft);
    setDraft('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends and Shift+Enter starts a new line. Not while an input
    // method is composing a word, where Enter is what confirms the word.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    submit();
  }

  function handleMicPress(): void {
    if (!voice) return;

    if (activity === 'idle') {
      voice.startListening();
    } else if (isListening) {
      // A deliberate stop keeps the recording and sends it.
      voice.stopListening();
    } else {
      // Sending or speaking: one press returns to rest.
      voice.reset();
    }
  }

  return (
    <div className="shrink-0">
      {voiceOn && (
        <p className="sr-only" role="status" aria-live="polite">
          {ANNOUNCEMENT[activity]}
        </p>
      )}

      {micProblem && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl bg-danger-50 px-4 py-2.5 text-sm leading-relaxed text-danger-700 ring-1 ring-danger-500/20"
        >
          <p className="min-w-0">{micProblem}</p>
          {/* A missing microphone cannot be retried into existence; a
              refused or busy one can. */}
          {voice?.micStatus !== 'unavailable' && (
            <button
              type="button"
              onClick={voice?.retryMicrophone}
              className="inline-flex min-h-10 items-center font-semibold underline-offset-2 hover:underline"
            >
              Try the microphone again
            </button>
          )}
        </div>
      )}

      {voiceOn && voice?.speechError && (
        <p role="status" className="mb-2 px-2 text-center text-[0.8125rem] text-ink-500">
          {voice.speechError}
        </p>
      )}

      <form className="flex items-end gap-2" onSubmit={handleSubmit}>
        {isVoiceTurn ? (
          <div
            aria-hidden="true"
            className="flex min-h-12 flex-1 items-center gap-3 rounded-3xl bg-white px-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200"
          >
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                isListening ? 'animate-pulse bg-danger-500' : 'bg-brand-400',
              )}
            />
            <span className="truncate text-[0.9375rem] text-ink-600">
              {isListening ? 'Listening… tap stop to send' : 'Sending what you said…'}
            </span>
          </div>
        ) : (
          <>
            <label htmlFor="assistant-message" className="sr-only">
              Type your message to the assistant
            </label>

            <textarea
              ref={inputRef}
              id="assistant-message"
              name="message"
              rows={1}
              // Off, because banking questions are not worth autocompleting
              // from a shared device's history.
              autoComplete="off"
              // Puts a Send key on a phone's keyboard.
              enterKeyHint="send"
              placeholder="Message the assistant"
              className="block max-h-[8.5rem] min-h-12 flex-1 resize-none rounded-3xl bg-white px-4 py-3 text-base leading-6 text-ink-900 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200 transition-shadow placeholder:text-ink-400 focus:ring-2 focus:ring-brand-500/50 focus-visible:outline-none"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              // Deliberately NOT disabled while a reply is in flight.
              // Disabling an element blurs it, so the customer would lose
              // their place after every message. Submission is gated by
              // canSend instead, which keeps the draft safe without moving
              // focus.
            />
          </>
        )}

        {showMicrophone ? (
          <button
            type="button"
            onClick={handleMicPress}
            aria-label={MIC_LABEL[activity]}
            aria-busy={activity === 'processing' || undefined}
            className={cn(
              ROUND_BUTTON,
              'text-white shadow-[0_6px_16px_-6px_rgb(12_51_49/0.5)]',
              isListening
                ? 'bg-danger-600 hover:bg-danger-700'
                : activity === 'idle'
                  ? 'bg-brand-600 hover:bg-brand-700'
                  : 'bg-ink-900 hover:bg-ink-800',
            )}
          >
            {/* Recording should be obvious at a glance. Hidden for
                reduced motion. */}
            {isListening && (
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full bg-danger-500/30 motion-reduce:hidden"
              />
            )}
            <span className="relative">
              {activity === 'processing' ? (
                <Spinner className="size-5" label={null} />
              ) : activity === 'idle' ? (
                <MicIcon />
              ) : (
                <StopIcon />
              )}
            </span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            aria-busy={isSending || undefined}
            className={cn(
              ROUND_BUTTON,
              'bg-brand-600 text-white shadow-[0_6px_16px_-6px_rgb(12_51_49/0.5)] hover:bg-brand-700',
              'disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none',
            )}
          >
            {isSending ? <Spinner className="size-5" label={null} /> : <SendIcon />}
          </button>
        )}
      </form>
    </div>
  );
}

function SendIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  );
}

function MicIcon() {
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
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" />
    </svg>
  );
}

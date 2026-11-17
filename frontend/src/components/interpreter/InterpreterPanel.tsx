import { useId, useMemo } from 'react';
import { AudioOutputSettings } from '@/components/interpreter/AudioOutputSettings';
import { Spinner } from '@/components/ui/Spinner';
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback';
import { listenerFor, PARTY_LABEL, useInterpreter } from '@/hooks/useInterpreter';
import { useInterpreterAudioRouting } from '@/hooks/useInterpreterAudioRouting';
import { cn } from '@/lib/cn';
import { createWebAudioOutput, type InterpreterAudioOutput } from '@/lib/interpreterAudioOutput';
import { interpreterClient } from '@/services/interpreter';
import type {
  InterpreterClient,
  InterpreterEntry,
  InterpreterParty,
  InterpreterRetry,
} from '@/types/interpreter';

export interface InterpreterPanelProps {
  sessionId: string;
  /** The visit's language: the customer's side of the conversation. */
  customerLanguage: string;
  /** What the assistant was doing, shown as saved. Null when nothing was. */
  savedTask: string | null;
  onReturn: () => void;
  /** Injectable for tests; the real client and browser output otherwise. */
  client?: InterpreterClient;
  output?: InterpreterAudioOutput;
}

const TURN_BUTTON: Record<InterpreterParty, string> = {
  customer: 'My turn — Speak',
  staff: 'Staff turn — Speak',
};

const RETRY_LABEL: Record<InterpreterRetry, (party: InterpreterParty) => string> = {
  speak_again: (party) => `${PARTY_LABEL[party]}: speak again`,
  translate: () => 'Translate again',
  play: () => 'Play the translation again',
};

const PRIMARY =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-600 px-5 text-[0.9375rem] font-semibold text-white transition-[background-color,scale] duration-150 hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45';
const SECONDARY =
  'inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[0.9375rem] font-semibold text-ink-800 ring-1 ring-ink-200 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-45';

/**
 * The face-to-face interpreter, shown in place of the conversation.
 *
 * A customer and a member of staff take turns on the customer's phone.
 * Each turn is recognised in the speaker's language, translated into the
 * other's, shown as both, and read aloud for the listener where a voice
 * exists. Nothing said here reaches the assistant: its conversation and
 * workflow wait, untouched, for Return to AI.
 */
export function InterpreterPanel({
  sessionId,
  customerLanguage,
  savedTask,
  onReturn,
  client = interpreterClient,
  output,
}: InterpreterPanelProps) {
  // One player per listener, each sent to that listener's device, and a
  // never-routed one for the explicit shared-output fallback.
  const speakerPlayback = useSpeechPlayback();
  const headphonesPlayback = useSpeechPlayback();
  const sharedPlayback = useSpeechPlayback();
  const players = {
    system_speaker: speakerPlayback,
    bluetooth_headphones: headphonesPlayback,
    shared: sharedPlayback,
  };
  const routing = useInterpreterAudioRouting(players);
  const webOutput = useMemo(
    () => createWebAudioOutput({ players, readiness: routing.readiness }),
    // players is rebuilt from these three each render.
    [speakerPlayback, headphonesPlayback, sharedPlayback, routing.readiness],
  );

  const interpreter = useInterpreter({
    sessionId,
    customerLanguage,
    client,
    output: output ?? webOutput,
  });

  const titleId = useId();
  const staffSelectId = useId();

  const {
    phase,
    speaker,
    nextSpeaker,
    entries,
    error,
    canSpeak,
    customer,
    staffLanguage,
    staffChoices,
    languages,
    languagesStatus,
  } = interpreter;

  const nameOf = (code: string): string =>
    languages.find((language) => language.code === code)?.name ?? code;

  const working = !['idle', 'awaiting_next_turn', 'error'].includes(phase);
  const active = speaker ?? nextSpeaker;
  const staffName = staffLanguage ? nameOf(staffLanguage) : '';
  const targetName = active === 'customer' ? staffName : (customer?.name ?? '');

  const status = (() => {
    if (languagesStatus === 'loading') return 'Loading the interpreter languages…';
    if (languagesStatus === 'error') return 'The interpreter languages could not be loaded.';
    if (!customer) return 'The interpreter is not available in your language yet.';
    if (!staffLanguage) return 'No other language is available for staff.';

    switch (phase) {
      case 'idle':
        return 'Choose who speaks first.';
      case 'listening':
        return `${PARTY_LABEL[active]} is speaking. Listening stops by itself when you finish.`;
      case 'recognizing':
        return `Recognising what ${PARTY_LABEL[active].toLowerCase()} said…`;
      case 'translating':
        return `Translating into ${targetName}…`;
      case 'speaking':
        return `Playing the translation for ${PARTY_LABEL[listenerFor(active)].toLowerCase()}…`;
      case 'awaiting_next_turn':
        return `${PARTY_LABEL[nextSpeaker]}’s turn next.`;
      case 'error':
        return error?.message ?? 'Something went wrong.';
    }
  })();

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-2 pb-3"
    >
      <div className="rounded-3xl bg-white px-4 py-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink-900">
              Face-to-Face Interpreter
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Machine translation. Confirm amounts and account details with staff.
            </p>
          </div>

          <button type="button" onClick={onReturn} className={SECONDARY}>
            Return to AI
          </button>
        </div>

        {savedTask && (
          <p className="mt-3 rounded-2xl bg-ink-50 px-3.5 py-2 text-sm text-ink-700 ring-1 ring-ink-200/70">
            {savedTask}
          </p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-[0.1em] text-ink-500 uppercase">
              Customer language
            </p>
            <p className="mt-1 text-[0.9375rem] font-medium text-ink-900" data-testid="customer-language">
              {customer?.name ?? customerLanguage}
            </p>
          </div>

          <div>
            <label
              htmlFor={staffSelectId}
              className="text-xs font-medium tracking-[0.1em] text-ink-500 uppercase"
            >
              Staff language
            </label>
            <select
              id={staffSelectId}
              value={staffLanguage ?? ''}
              onChange={(event) => interpreter.setStaffLanguage(event.target.value)}
              disabled={working || staffChoices.length === 0}
              className="mt-1 block min-h-11 w-full rounded-xl bg-white px-3 text-[0.9375rem] text-ink-900 ring-1 ring-ink-200 disabled:opacity-60"
            >
              {staffChoices.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                  {language.speech ? '' : ' (text only)'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <AudioOutputSettings routing={routing} busy={working} />

      {/* One announcement per change of state; colour is never the only signal. */}
      <div className="rounded-3xl bg-white px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
        <p className="text-xs font-medium tracking-[0.1em] text-ink-500 uppercase">
          {phase === 'idle' ? 'Ready' : `${PARTY_LABEL[active]}’s turn`}
        </p>
        <p
          role="status"
          aria-live="polite"
          data-testid="interpreter-status"
          className="mt-1 flex items-center gap-2 text-[0.9375rem] font-medium text-ink-800"
        >
          {working && phase !== 'listening' && <Spinner className="size-4" label={null} />}
          {phase === 'listening' && (
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-danger-500" />
          )}
          {status}
        </p>

        {languagesStatus === 'error' && (
          <button type="button" onClick={interpreter.reloadLanguages} className={cn(SECONDARY, 'mt-3')}>
            Try loading the languages again
          </button>
        )}

        {phase === 'error' && error?.retry && (
          <div role="alert" className="mt-3">
            <button type="button" onClick={interpreter.retry} className={SECONDARY}>
              {RETRY_LABEL[error.retry](error.speaker)}
            </button>
          </div>
        )}
      </div>

      <ol aria-label="Interpreter conversation" className="flex flex-col gap-2">
        {entries.map((entry) => (
          <TranscriptEntry key={entry.id} entry={entry} nameOf={nameOf} />
        ))}
      </ol>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {phase === 'listening' ? (
          <>
            <button type="button" onClick={interpreter.finishSpeaking} className={PRIMARY}>
              Done speaking
            </button>
            <button type="button" onClick={interpreter.cancel} className={SECONDARY}>
              Cancel
            </button>
          </>
        ) : working ? (
          <button type="button" onClick={interpreter.cancel} className={SECONDARY}>
            Cancel
          </button>
        ) : (
          (['customer', 'staff'] as const).map((party) => (
            <button
              key={party}
              type="button"
              onClick={() => interpreter.startTurn(party)}
              disabled={!canSpeak}
              // The suggested next speaker is the filled button; the
              // label says whose turn it is either way.
              className={party === nextSpeaker ? PRIMARY : SECONDARY}
            >
              {TURN_BUTTON[party]}
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function TranscriptEntry({
  entry,
  nameOf,
}: {
  entry: InterpreterEntry;
  nameOf: (code: string) => string;
}) {
  const customer = entry.speaker === 'customer';

  return (
    <li
      className={cn(
        'rounded-2xl px-4 py-3 ring-1',
        customer ? 'bg-brand-50/60 ring-brand-100' : 'bg-white ring-ink-200/70',
      )}
    >
      <p className="text-xs font-semibold text-ink-700">
        {PARTY_LABEL[entry.speaker]}
        <span className="font-normal text-ink-500">
          {' '}
          · {nameOf(entry.sourceLanguage)} → {nameOf(entry.targetLanguage)}
        </span>
      </p>

      <p lang={entry.sourceLanguage} className="mt-1 text-[0.9375rem] text-ink-900">
        <span className="sr-only">Said: </span>
        {entry.original}
      </p>

      {entry.translation ? (
        <p lang={entry.targetLanguage} className="mt-1.5 text-[0.9375rem] font-medium text-ink-900">
          <span className="sr-only">Translation: </span>
          <span aria-hidden="true" className="text-ink-400">
            ↳{' '}
          </span>
          {entry.translation}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-ink-500">
          {entry.status === 'failed' ? 'Not translated yet.' : 'Translating…'}
        </p>
      )}

      {entry.speechNote && <p className="mt-1 text-sm text-ink-500">{entry.speechNote}</p>}
    </li>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMicrophone } from '@/hooks/useMicrophone';
import type { InterpreterAudioOutput } from '@/lib/interpreterAudioOutput';
import { ApiError } from '@/types/api';
import type {
  InterpreterClient,
  InterpreterEntry,
  InterpreterError,
  InterpreterLanguage,
  InterpreterParty,
  InterpreterPhase,
} from '@/types/interpreter';

export interface UseInterpreterOptions {
  sessionId: string;
  /** The visit's language: the customer's side of every turn. */
  customerLanguage: string;
  client: InterpreterClient;
  output: InterpreterAudioOutput;
}

export interface Interpreter {
  languages: InterpreterLanguage[];
  languagesStatus: 'loading' | 'ready' | 'error';
  reloadLanguages: () => void;
  /** The customer's language, or null when the interpreter does not offer it. */
  customer: InterpreterLanguage | null;
  staffLanguage: string | null;
  setStaffLanguage: (code: string) => void;
  /** Languages staff may speak: every offered language but the customer's. */
  staffChoices: InterpreterLanguage[];

  phase: InterpreterPhase;
  /** Whose turn is running, or ran last. */
  speaker: InterpreterParty | null;
  /** Who would naturally speak next, after a completed turn. */
  nextSpeaker: InterpreterParty;
  entries: InterpreterEntry[];
  error: InterpreterError | null;
  /** True when a new turn may start: nothing is recording, processing or playing. */
  canSpeak: boolean;

  startTurn: (speaker: InterpreterParty) => void;
  /** Ends the recording now and processes it, for anyone who does not want to wait. */
  finishSpeaking: () => void;
  /** Abandons whatever is running. Completed turns are kept. */
  cancel: () => void;
  retry: () => void;
  readMicLevel: () => number | null;
}

/** Who hears a translation: the other party. */
export const listenerFor = (speaker: InterpreterParty): InterpreterParty =>
  speaker === 'customer' ? 'staff' : 'customer';

export const PARTY_LABEL: Record<InterpreterParty, string> = {
  customer: 'Customer',
  staff: 'Staff',
};

const RESTING: InterpreterPhase[] = ['idle', 'awaiting_next_turn', 'error'];

function entryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

/**
 * The interpreter's turn-taking, as one explicit state machine:
 *
 *   idle -> listening -> recognizing -> translating -> speaking
 *        -> awaiting_next_turn -> listening -> ...
 *
 * with `error` reachable from every working phase and a retry that repeats
 * only the step that failed. Exactly one thing happens at a time: a turn
 * cannot start while another is recording, being processed or being read
 * aloud, so the microphone never records a translation being played.
 *
 * Every asynchronous step carries the number of the turn it belongs to, and
 * does nothing once that turn is no longer current -- cancelled, superseded
 * or unmounted. A recording is processed once, however often the recorder
 * reports it.
 *
 * Nothing here touches the assistant's conversation: interpreted words are
 * recognised and translated, never sent as a turn.
 */
export function useInterpreter({
  sessionId,
  customerLanguage,
  client,
  output,
}: UseInterpreterOptions): Interpreter {
  const [languages, setLanguages] = useState<InterpreterLanguage[]>([]);
  const [languagesStatus, setLanguagesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [languagesRequest, setLanguagesRequest] = useState(0);
  const [chosenStaffLanguage, setChosenStaffLanguage] = useState<string | null>(null);

  const [phase, setPhaseState] = useState<InterpreterPhase>('idle');
  const [speaker, setSpeaker] = useState<InterpreterParty | null>(null);
  const [lastCompleted, setLastCompleted] = useState<InterpreterParty | null>(null);
  const [entries, setEntries] = useState<InterpreterEntry[]>([]);
  const [error, setError] = useState<InterpreterError | null>(null);

  // Read synchronously by guards: a double tap lands before React re-renders.
  const phaseRef = useRef<InterpreterPhase>('idle');
  const setPhase = useCallback((next: InterpreterPhase): void => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  /** The current turn. Bumped by every start, retry and cancel. */
  const turnRef = useRef(0);
  /** The turn whose recording has already been taken: one recording, one entry. */
  const takenRef = useRef(0);
  const speakerRef = useRef<InterpreterParty | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const entriesRef = useRef<InterpreterEntry[]>([]);
  entriesRef.current = entries;

  // Current values for callbacks that outlive the render that made them.
  const clientRef = useRef(client);
  clientRef.current = client;
  const outputRef = useRef(output);
  outputRef.current = output;

  const customer = useMemo(
    () => languages.find((language) => language.code === customerLanguage) ?? null,
    [languages, customerLanguage],
  );
  const staffChoices = useMemo(
    () => languages.filter((language) => language.code !== customerLanguage),
    [languages, customerLanguage],
  );
  const staffLanguage =
    chosenStaffLanguage && staffChoices.some((l) => l.code === chosenStaffLanguage)
      ? chosenStaffLanguage
      : (staffChoices[0]?.code ?? null);

  const languagesRef = useRef({ customer: customerLanguage, staff: staffLanguage, list: languages });
  languagesRef.current = { customer: customerLanguage, staff: staffLanguage, list: languages };

  useEffect(() => {
    const controller = new AbortController();
    setLanguagesStatus('loading');

    clientRef.current
      .languages(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setLanguages(list);
        setLanguagesStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setLanguagesStatus('error');
      });

    return () => controller.abort();
  }, [languagesRequest]);

  const reloadLanguages = useCallback(() => setLanguagesRequest((n) => n + 1), []);

  const isCurrent = (turn: number): boolean => turnRef.current === turn;

  const updateEntry = useCallback((id: string, patch: Partial<InterpreterEntry>): void => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const fail = useCallback(
    (next: InterpreterError): void => {
      setError(next);
      setPhase('error');
    },
    [setPhase],
  );

  const completeTurn = useCallback(
    (party: InterpreterParty): void => {
      setError(null);
      setLastCompleted(party);
      setPhase('awaiting_next_turn');
    },
    [setPhase],
  );

  const freshSignal = (): AbortSignal => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  };

  /** Reads a translated entry to its listener. */
  const speakEntry = useCallback(
    async (entry: InterpreterEntry, turn: number): Promise<void> => {
      const target = languagesRef.current.list.find((l) => l.code === entry.targetLanguage);

      // No voice for this language: the translation is on screen, and saying
      // so is honest. Not an error -- the turn is complete.
      if (!target?.speech) {
        updateEntry(entry.id, {
          status: 'done',
          speechNote: `Spoken ${target?.name ?? 'output'} is not available yet. Please read the translation on screen.`,
        });
        completeTurn(entry.speaker);
        return;
      }

      setPhase('speaking');
      updateEntry(entry.id, { status: 'speaking', speechNote: null });

      let audio: Blob;

      try {
        audio = await clientRef.current.speak(
          { sessionId, text: entry.translation ?? '', language: entry.targetLanguage },
          freshSignal(),
        );
      } catch (caught) {
        if (!isCurrent(turn) || isAbort(caught)) return;

        updateEntry(entry.id, { status: 'done', speechNote: 'This translation could not be read aloud.' });
        fail({
          message: messageOf(caught, 'The translation could not be read aloud.'),
          speaker: entry.speaker,
          retry: 'play',
          entryId: entry.id,
        });
        return;
      }

      if (!isCurrent(turn)) return;

      const outcome = await outputRef.current.play(audio, listenerFor(entry.speaker));

      if (!isCurrent(turn)) return;

      // The listener's device is not chosen, not ready or was disconnected.
      // Nothing was played anywhere else; the text stays on screen.
      if (outcome === 'unrouted') {
        const listener = PARTY_LABEL[listenerFor(entry.speaker)].toLowerCase();
        updateEntry(entry.id, {
          status: 'done',
          speechNote: `Not played: no audio output is ready for the ${listener}.`,
        });
        fail({
          message: `The translation for the ${listener} was not played because their audio output is not ready. Check the audio outputs, then play it again.`,
          speaker: entry.speaker,
          retry: 'play',
          entryId: entry.id,
        });
        return;
      }

      if (outcome === 'failed') {
        updateEntry(entry.id, { status: 'done', speechNote: 'This translation could not be played.' });
        fail({
          message: 'The translation could not be played. Check the volume, then play it again.',
          speaker: entry.speaker,
          retry: 'play',
          entryId: entry.id,
        });
        return;
      }

      // 'ended', or 'stopped' by the customer: either way the turn is over.
      updateEntry(entry.id, { status: 'done' });
      completeTurn(entry.speaker);
    },
    // freshSignal and isCurrent read refs only, so they are not dependencies.
    [sessionId, updateEntry, completeTurn, fail, setPhase],
  );

  /** Translates a recognised entry, then reads it aloud. */
  const translateEntry = useCallback(
    async (entry: InterpreterEntry, turn: number): Promise<void> => {
      setPhase('translating');
      updateEntry(entry.id, { status: 'translating' });

      let translation: string;

      try {
        ({ translation } = await clientRef.current.translate(
          {
            sessionId,
            text: entry.original,
            sourceLanguage: entry.sourceLanguage,
            targetLanguage: entry.targetLanguage,
          },
          freshSignal(),
        ));
      } catch (caught) {
        if (!isCurrent(turn) || isAbort(caught)) return;

        // The original stays on screen; only translation is retried.
        updateEntry(entry.id, { status: 'failed' });
        fail({
          message: messageOf(caught, 'The translation could not be produced.'),
          speaker: entry.speaker,
          retry: 'translate',
          entryId: entry.id,
        });
        return;
      }

      if (!isCurrent(turn)) return;

      const translated = { ...entry, translation };
      updateEntry(entry.id, { translation });
      await speakEntry(translated, turn);
    },
    [sessionId, updateEntry, fail, setPhase, speakEntry],
  );

  const handleRecorded = useCallback(
    async ({ blob, mimeType }: { blob: Blob; mimeType: string }): Promise<void> => {
      const turn = turnRef.current;
      const party = speakerRef.current;

      // One recording per turn, and only for a turn still running.
      if (!party || takenRef.current === turn || phaseRef.current !== 'listening') return;
      takenRef.current = turn;

      const { customer: customerCode, staff: staffCode } = languagesRef.current;
      if (!staffCode) return;

      const sourceLanguage = party === 'customer' ? customerCode : staffCode;
      const targetLanguage = party === 'customer' ? staffCode : customerCode;

      setPhase('recognizing');

      let text: string;

      try {
        ({ text } = await clientRef.current.transcribe(
          { sessionId, language: sourceLanguage, audio: blob, mimeType },
          freshSignal(),
        ));
      } catch (caught) {
        if (!isCurrent(turn) || isAbort(caught)) return;

        fail({
          message: messageOf(caught, 'That could not be recognised.'),
          speaker: party,
          retry: 'speak_again',
          entryId: null,
        });
        return;
      }

      if (!isCurrent(turn)) return;

      // Nothing heard is never translated into something.
      if (!text.trim()) {
        fail({
          message: `I did not catch that. ${PARTY_LABEL[party]}, please speak again.`,
          speaker: party,
          retry: 'speak_again',
          entryId: null,
        });
        return;
      }

      const entry: InterpreterEntry = {
        id: entryId(),
        speaker: party,
        sourceLanguage,
        targetLanguage,
        original: text.trim(),
        translation: null,
        status: 'translating',
        speechNote: null,
      };

      setEntries((current) => [...current, entry]);
      await translateEntry(entry, turn);
    },
    [sessionId, fail, setPhase, translateEntry],
  );

  const mic = useMicrophone({ onRecorded: handleRecorded });
  const micRef = useRef(mic);
  micRef.current = mic;

  /**
   * A turn waiting for a refused or failed microphone to be reset.
   *
   * The microphone's start() reads its own status as of the last render, so
   * it cannot be reset and started in the same tap. The reset is applied,
   * and the start follows on the next render.
   */
  const pendingStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingStartRef.current === null || mic.status !== 'idle') return;

    const turn = pendingStartRef.current;
    pendingStartRef.current = null;

    if (isCurrent(turn) && phaseRef.current === 'listening') void mic.start();
    // isCurrent reads a ref only.
  }, [mic.status, mic.start]);

  // The microphone failed, or the speaker said nothing at all.
  useEffect(() => {
    const party = speakerRef.current;
    if (phaseRef.current !== 'listening' || !party) return;

    if (mic.status === 'denied' || mic.status === 'unavailable' || mic.status === 'error') {
      turnRef.current += 1;
      fail({
        message: mic.message ?? 'The microphone could not be used.',
        speaker: party,
        retry: mic.status === 'unavailable' ? null : 'speak_again',
        entryId: null,
      });
    }
  }, [mic.status, mic.message, fail]);

  useEffect(() => {
    const party = speakerRef.current;
    if (phaseRef.current !== 'listening' || !party) return;

    if (mic.lastEnd === 'no_speech') {
      turnRef.current += 1;
      fail({
        message: `I did not hear anything. ${PARTY_LABEL[party]}, please speak again.`,
        speaker: party,
        retry: 'speak_again',
        entryId: null,
      });
    }
  }, [mic.lastEnd, fail]);

  const canSpeak =
    RESTING.includes(phase) &&
    languagesStatus === 'ready' &&
    customer !== null &&
    staffLanguage !== null &&
    mic.status !== 'unavailable';

  const canSpeakRef = useRef(canSpeak);
  canSpeakRef.current = canSpeak;

  const startTurn = useCallback(
    (party: InterpreterParty): void => {
      if (!canSpeakRef.current || !RESTING.includes(phaseRef.current)) return;

      // Inside the tap: the one moment a browser grants permission to play
      // the translation later. Anything still sounding stops first.
      outputRef.current.stop();
      outputRef.current.unlock();
      abortRef.current?.abort();

      turnRef.current += 1;
      speakerRef.current = party;
      setSpeaker(party);
      setError(null);
      setPhase('listening');

      const microphone = micRef.current;

      // A refused microphone is not retried silently; this tap is the
      // customer asking again. Its start follows the reset (see above).
      if (microphone.status === 'denied' || microphone.status === 'error') {
        pendingStartRef.current = turnRef.current;
        microphone.retry();
        return;
      }

      void microphone.start();
    },
    [setPhase],
  );

  const finishSpeaking = useCallback((): void => {
    if (phaseRef.current === 'listening') micRef.current.stop();
  }, []);

  const cancel = useCallback((): void => {
    if (RESTING.includes(phaseRef.current)) return;

    turnRef.current += 1;
    abortRef.current?.abort();
    micRef.current.cancel();
    outputRef.current.stop();

    // A turn interrupted before it was translated keeps its words, marked
    // so it can be translated later; one interrupted while speaking is done.
    setEntries((current) =>
      current.map((entry) =>
        entry.status === 'translating'
          ? { ...entry, status: 'failed' }
          : entry.status === 'speaking'
            ? { ...entry, status: 'done' }
            : entry,
      ),
    );
    setError(null);
    setPhase(entriesRef.current.length > 0 ? 'awaiting_next_turn' : 'idle');
  }, [setPhase]);

  const retry = useCallback((): void => {
    const failure = error;
    if (!failure || phaseRef.current !== 'error') return;

    if (failure.retry === 'speak_again') {
      // The same speaker, a fresh recording. 'error' is a resting phase.
      startTurn(failure.speaker);
      return;
    }

    const entry = entriesRef.current.find((e) => e.id === failure.entryId);
    if (!entry) return;

    const turn = ++turnRef.current;
    setError(null);
    outputRef.current.unlock();

    if (failure.retry === 'translate' && entry.status === 'failed') {
      void translateEntry(entry, turn);
    } else if (failure.retry === 'play' && entry.translation) {
      void speakEntry(entry, turn);
    }
  }, [error, setPhase, startTurn, translateEntry, speakEntry]);

  // Nothing outlives the screen: requests are abandoned, playback stops.
  // The microphone hook releases itself.
  useEffect(
    () => () => {
      turnRef.current += 1;
      abortRef.current?.abort();
      outputRef.current.stop();
    },
    [],
  );

  return {
    languages,
    languagesStatus,
    reloadLanguages,
    customer,
    staffLanguage,
    setStaffLanguage: setChosenStaffLanguage,
    staffChoices,
    phase,
    speaker,
    nextSpeaker: lastCompleted ? listenerFor(lastCompleted) : 'customer',
    entries,
    error,
    canSpeak,
    startTurn,
    finishSpeaking,
    cancel,
    retry,
    readMicLevel: mic.readLevel,
  };
}

/**
 * The face-to-face interpreter: a customer and a member of staff talking
 * through the customer's phone, one turn at a time.
 *
 * Nothing here belongs to the assistant's conversation. Interpreted words
 * never become a turn, so they can never start or move a workflow.
 */

/** A language the interpreter offers, as the engine reports it. */
export interface InterpreterLanguage {
  code: string;
  name: string;
  /** Whether a translation INTO this language can be read aloud. */
  speech: boolean;
}

/** Who is speaking -- and, for a translation, who it is for. */
export type InterpreterParty = 'customer' | 'staff';

/**
 * Where the interpreter is, as one value rather than a set of booleans.
 *
 *   idle                nothing has been said yet
 *   listening           the microphone is open for `speaker`
 *   recognizing         turning the recording into text
 *   translating         turning that text into the listener's language
 *   speaking            the translation is being read to the listener
 *   awaiting_next_turn  a turn finished; either party may speak next
 *   error               the last step failed; see InterpreterError
 */
export type InterpreterPhase =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'translating'
  | 'speaking'
  | 'awaiting_next_turn'
  | 'error';

export type InterpreterEntryStatus = 'translating' | 'speaking' | 'done' | 'failed';

/** One person's turn: what they said, and what it became. */
export interface InterpreterEntry {
  id: string;
  speaker: InterpreterParty;
  sourceLanguage: string;
  targetLanguage: string;
  /** What speech recognition heard, in the speaker's language. */
  original: string;
  /** Null until translated, and if translation failed. */
  translation: string | null;
  status: InterpreterEntryStatus;
  /** Set when the translation was shown but could not be read aloud. */
  speechNote: string | null;
}

/** Which step a retry repeats. */
export type InterpreterRetry =
  /** Nothing usable was recorded: the same speaker speaks again. */
  | 'speak_again'
  /** The words were heard: translate them again, without re-recording. */
  | 'translate'
  /** The translation exists: read it aloud again. */
  | 'play';

export interface InterpreterError {
  message: string;
  /** The speaker whose turn failed, so a retry gives it back to them. */
  speaker: InterpreterParty;
  retry: InterpreterRetry | null;
  /** The transcript entry a 'translate' or 'play' retry acts on. */
  entryId: string | null;
}

/** The server calls the interpreter makes. Injectable for tests. */
export interface InterpreterClient {
  languages(signal?: AbortSignal): Promise<InterpreterLanguage[]>;
  transcribe(
    request: { sessionId: string; language: string; audio: Blob; mimeType: string },
    signal?: AbortSignal,
  ): Promise<{ text: string; language: string }>;
  translate(
    request: { sessionId: string; text: string; sourceLanguage: string; targetLanguage: string },
    signal?: AbortSignal,
  ): Promise<{ translation: string }>;
  speak(
    request: { sessionId: string; text: string; language: string },
    signal?: AbortSignal,
  ): Promise<Blob>;
}

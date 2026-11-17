import { IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * A language tag as the interpreter accepts it: 'kn', 'ta', 'en-IN'.
 *
 * Shape only. Which languages are actually offered is the engine's answer
 * (GET /assistant/interpreter/languages), and it refuses any other.
 */
const LANGUAGE_TAG = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/;
const LANGUAGE_MESSAGE = 'Choose a supported language.';

/** The form fields accompanying an interpreter recording. */
export class InterpreterTranscribeDto {
  @IsUUID(undefined, { message: 'sessionId must be a valid session identifier.' })
  sessionId!: string;

  /** The language of the person speaking -- customer or staff. */
  @Matches(LANGUAGE_TAG, { message: LANGUAGE_MESSAGE })
  language!: string;
}

export class InterpreterTranslateDto {
  @IsUUID(undefined, { message: 'sessionId must be a valid session identifier.' })
  sessionId!: string;

  @IsString()
  @IsNotEmpty({ message: 'There is nothing to translate.' })
  @MaxLength(1000, { message: 'That is too long to translate in one turn.' })
  text!: string;

  @Matches(LANGUAGE_TAG, { message: LANGUAGE_MESSAGE })
  sourceLanguage!: string;

  @Matches(LANGUAGE_TAG, { message: LANGUAGE_MESSAGE })
  targetLanguage!: string;
}

/**
 * A translation to read aloud for its listener.
 *
 * Unlike the assistant's own speech, the language is sent: an interpreter
 * speaks to staff in the staff's language, which is not the visit's. It is
 * still only ever one the engine has a voice for.
 */
export class InterpreterSpeakDto {
  @IsUUID(undefined, { message: 'sessionId must be a valid session identifier.' })
  sessionId!: string;

  @IsString()
  @IsNotEmpty({ message: 'There is nothing to read out.' })
  @MaxLength(2000, { message: 'That is too long to read out.' })
  text!: string;

  @Matches(LANGUAGE_TAG, { message: LANGUAGE_MESSAGE })
  language!: string;
}

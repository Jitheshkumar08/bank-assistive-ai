/**
 * What the assistant says when a customer arrives.
 *
 * The text is composed here rather than on the server because the
 * client already holds all three ingredients -- the name, the branch and
 * the visit's language -- and a round trip to assemble a sentence from
 * values it already has would be latency for nothing.
 *
 * The language keys match the engine's own voices exactly
 * (`app/speech/tts.py`), so the words and the voice reading them can
 * never disagree: a Kannada visit is spoken by the Kannada voice, from
 * the Kannada sentence.
 */

/** Longest name we will read aloud. Past this it stops being a greeting. */
const MAX_SPOKEN_NAME = 40;

type Compose = (name: string, branch: string) => string;

const GREETINGS: Record<string, Compose> = {
  en: (name, branch) => `Welcome, ${name}. You are at ${branch}. How can I help you today?`,
  kn: (name, branch) => `ನಮಸ್ಕಾರ ${name}. ನೀವು ${branch} ನಲ್ಲಿ ಇದ್ದೀರಿ. ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`,
  hi: (name, branch) => `नमस्ते ${name}. आप ${branch} में हैं. मैं आपकी कैसे मदद कर सकती हूँ?`,
};

/**
 * The name to say out loud.
 *
 * First name only: "Welcome, Anita Rao Shetty" reads like a summons
 * rather than a greeting. The full name stays on screen, where length
 * costs nothing.
 */
export function firstName(fullName: string): string {
  const [first] = fullName.trim().split(/\s+/);
  return (first ?? fullName).slice(0, MAX_SPOKEN_NAME);
}

/**
 * Builds the spoken welcome.
 *
 * An unknown language falls back to English rather than returning
 * nothing: a greeting in the wrong language is a small annoyance, and
 * silence at the moment someone arrives is a broken feature.
 */
export function composeGreeting(options: {
  language: string;
  fullName: string;
  branchName: string;
}): string {
  const compose = GREETINGS[options.language] ?? GREETINGS.en;

  return compose(firstName(options.fullName), options.branchName.trim());
}

/** The languages a greeting exists for. Exported for tests and tooling. */
export const GREETING_LANGUAGES = Object.keys(GREETINGS);

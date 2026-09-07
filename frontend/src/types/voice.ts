/**
 * Whether the customer wants voice assistance available.
 *
 * Three-valued on purpose. "Never asked" has to be distinguishable from
 * "asked and declined", or the opt-in either nags someone who already
 * said no or never appears for someone who has not been asked.
 */
export type VoicePreference = 'unset' | 'enabled' | 'disabled';

/**
 * What voice is doing right now.
 *
 * Deliberately separate from the preference above. Conflating the two is
 * exactly how "voice is on" turns into "the microphone is always
 * recording" -- availability is a settled choice, activity is momentary
 * and always started by the customer.
 *
 *   idle       nothing happening; the microphone is closed
 *   listening  the customer is speaking to us
 *   processing the utterance is with the assistant
 *   speaking   a reply is being read aloud
 */
export type VoiceActivity = 'idle' | 'listening' | 'processing' | 'speaking';

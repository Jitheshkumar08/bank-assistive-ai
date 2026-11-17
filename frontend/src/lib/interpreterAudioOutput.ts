import type { PlaybackOutcome, SpeechPlayback } from '@/hooks/useSpeechPlayback';
import type { InterpreterParty } from '@/types/interpreter';

/**
 * Where a translation is played, kept behind one small interface.
 *
 * The interpreter decides WHO a translation is for -- staff hear the
 * customer's words, the customer hears the staff's -- and asks for it to be
 * played to that listener. Each listener has a destination of their own:
 *
 *   staff     system_speaker         the laptop's built-in speaker
 *   customer  bluetooth_headphones   the customer's headphones
 *
 * How a destination is reached is the platform's business:
 *
 *   web (this file)  one audio element per destination, each pointed at a
 *                    device the staff chose with setSinkId(). A destination
 *                    whose device is not chosen, not verified or gone is
 *                    NOT played -- play() resolves 'unrouted' -- unless
 *                    staff explicitly accepted the fallback, in which case
 *                    it plays on a third, never-routed element: the
 *                    browser's default output, whoever's device that is.
 *   Android (later)  a native adapter implementing this same interface,
 *                    routing staff-bound speech to the loudspeaker and
 *                    customer-bound speech to Bluetooth through the OS
 *                    audio APIs.
 */
export type AudioDestination = 'system_speaker' | 'bluetooth_headphones';

/** How a translation's playback ended; 'unrouted' means it was not played because its device is not ready. */
export type InterpreterPlaybackOutcome = PlaybackOutcome | 'unrouted';

export interface InterpreterAudioOutput {
  /** Plays `audio` for `listener`. Always settles; 'ended' means it was heard in full. */
  play: (audio: Blob, listener: InterpreterParty) => Promise<InterpreterPlaybackOutcome>;
  /** Stops whatever is playing, on every destination. */
  stop: () => void;
  /** Buys permission to play later. Call inside a tap. */
  unlock: () => void;
}

/** Who hears what, by the LISTENER of a translation -- never by its speaker. */
export const DESTINATION_FOR: Record<InterpreterParty, AudioDestination> = {
  staff: 'system_speaker',
  customer: 'bluetooth_headphones',
};

export const DESTINATIONS: AudioDestination[] = ['system_speaker', 'bluetooth_headphones'];

/** The players behind the web adapter: one per destination, plus the fallback. */
export type PlayerSlot = AudioDestination | 'shared';

/**
 * Whether a destination may be played right now.
 *
 *   ready     its own device is chosen and its element is verified on it
 *   shared    it is not, but staff accepted the default-output fallback
 *   unrouted  neither: do not play
 */
export type RouteReadiness = 'ready' | 'shared' | 'unrouted';

export interface WebAudioOutputOptions {
  /** One player per destination, each routed to its device, and the unrouted fallback. */
  players: Record<PlayerSlot, SpeechPlayback>;
  /** Read at the moment of playing, so it is never stale. */
  readiness: (destination: AudioDestination) => RouteReadiness;
}

const SLOTS: PlayerSlot[] = [...DESTINATIONS, 'shared'];

/** The browser adapter: a routed player per destination. */
export function createWebAudioOutput({ players, readiness }: WebAudioOutputOptions): InterpreterAudioOutput {
  const stopAll = (): void => {
    for (const slot of SLOTS) players[slot].stop();
  };

  return {
    play: async (audio, listener) => {
      const destination = DESTINATION_FOR[listener];

      const route = readiness(destination);
      if (route === 'unrouted') return 'unrouted';

      const slot: PlayerSlot = route === 'ready' ? destination : 'shared';

      // One voice at a time, whichever device it is on.
      for (const other of SLOTS) if (other !== slot) players[other].stop();

      const outcome = await players[slot].play(audio);

      // Cut off because its device disappeared mid-sentence: not heard, and
      // not to be counted as a finished turn.
      if (outcome === 'stopped' && readiness(destination) === 'unrouted') return 'unrouted';

      return outcome;
    },
    stop: stopAll,
    unlock: () => {
      for (const slot of SLOTS) players[slot].unlock();
    },
  };
}

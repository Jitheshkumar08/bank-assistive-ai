/**
 * Decides when a spoken utterance has ended, from audio levels alone.
 *
 * The browser counterpart of the language engine's CLI recorder
 * (`language_engine/app/speech/recorder.py`, `AudioRecorder._capture` and
 * `_finalize`). That recorder cannot serve the web: it reads the microphone
 * of the machine running Python. Its TIMING is what is reused here, value
 * for value, so the web and the CLI end a turn at the same moments:
 *
 *   minimum speech        300 ms   shorter bursts are not an utterance
 *   end-of-speech silence 800 ms   silence that ends the utterance
 *   no-speech timeout      15 s    waiting this long with no speech gives up
 *   maximum recording      30 s    hard ceiling, measured from speech onset
 *   start frames            2      consecutive speech frames to begin
 *
 * Progress is counted in FRAMES, as the CLI counts it, not in wall-clock
 * time. A throttled timer therefore only ever stretches a window -- it can
 * end a turn later, never early -- and tests are deterministic.
 *
 * WHAT COUNTS AS SPEECH
 *
 * Silero (the CLI's detector) is a neural model and is not available in the
 * browser without a new dependency, so this uses LEVEL against an ADAPTIVE
 * NOISE FLOOR:
 *
 *   - The first `calibrationMs` set the floor from the room itself, as the
 *     MEDIAN level: a mean in dB is dragged far down by one or two near-silent
 *     frames while the microphone warms up, and a floor set that low lets
 *     ordinary room noise pass for speech that never ends.
 *   - While waiting, the floor follows the room: down quickly, up slowly, so a
 *     fan or a corridor raises the bar instead of being mistaken for speech.
 *   - Speech must rise `startMarginDb` above the floor to start, and stay
 *     `continueMarginDb` above it to continue. The gap is the same hysteresis
 *     idea as the CLI's 0.5 / 0.35 thresholds: a soft consonant mid-word does
 *     not end the turn.
 *   - Nothing quieter than `absoluteFloorDb` is ever speech, so digital
 *     silence and a dead input cannot qualify however low the floor sinks.
 *
 * Silence carries no meaning beyond "nothing was said": a `no_speech` result
 * means the recording is dropped, never that a workflow step was answered.
 */

export interface EndpointingConfig {
  /** Analysis interval. 32 ms matches the CLI's 512-sample frame at 16 kHz. */
  frameMs: number;
  minSpeechMs: number;
  endSilenceMs: number;
  noSpeechTimeoutMs: number;
  /** Measured from speech onset, like the CLI's `max_recording_ms`. */
  maxRecordingMs: number;
  startFrames: number;
  /** Time spent measuring the room before detection begins. */
  calibrationMs: number;
  startMarginDb: number;
  continueMarginDb: number;
  /** Level (dBFS) below which nothing counts as speech. */
  absoluteFloorDb: number;
  /** Bounds on the adaptive floor, so one odd frame cannot run it away. */
  minNoiseFloorDb: number;
  maxNoiseFloorDb: number;
}

export const DEFAULT_ENDPOINTING: Readonly<EndpointingConfig> = Object.freeze({
  frameMs: 32,
  minSpeechMs: 300,
  endSilenceMs: 800,
  noSpeechTimeoutMs: 15_000,
  maxRecordingMs: 30_000,
  startFrames: 2,
  calibrationMs: 160,
  startMarginDb: 15,
  continueMarginDb: 9,
  absoluteFloorDb: -55,
  minNoiseFloorDb: -90,
  maxNoiseFloorDb: -25,
});

/** Why a recording ended on its own. */
export type EndpointReason =
  /** Speech, then `endSilenceMs` of silence: submit. */
  | 'speech_ended'
  /** `maxRecordingMs` after onset with enough speech: submit. */
  | 'max_duration'
  /** Nothing that qualifies as speech: discard, never submit. */
  | 'no_speech';

export interface EndpointDecision {
  reason: EndpointReason;
  /** True only for reasons that carry an utterance worth transcribing. */
  submit: boolean;
}

export interface SpeechDetector {
  /**
   * Feeds one frame's level in dBFS. Returns a decision the first time the
   * recording should end, and null otherwise. After a decision every
   * further call returns null: one recording ends exactly once.
   */
  push: (levelDb: number) => EndpointDecision | null;
  readonly state: 'calibrating' | 'waiting' | 'speaking' | 'done';
}

/** Down fast (a quiet moment is good evidence), up slowly (speech is not). */
const FLOOR_FALL = 0.3;
const FLOOR_RISE = 0.05;

function frames(ms: number, frameMs: number): number {
  return Math.max(1, Math.round(ms / frameMs));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createSpeechDetector(overrides: Partial<EndpointingConfig> = {}): SpeechDetector {
  const config: EndpointingConfig = { ...DEFAULT_ENDPOINTING, ...overrides };

  const calibrationFrames = frames(config.calibrationMs, config.frameMs);
  const minSpeechFrames = frames(config.minSpeechMs, config.frameMs);
  const endSilenceFrames = frames(config.endSilenceMs, config.frameMs);
  const maxWaitFrames = frames(config.noSpeechTimeoutMs, config.frameMs);
  const maxRecordingFrames = frames(config.maxRecordingMs, config.frameMs);

  let state: SpeechDetector['state'] = 'calibrating';
  const calibration: number[] = [];
  let floor = config.minNoiseFloorDb;

  // Frames since the attempt began. The CLI ends its record() call on a
  // rejected burst, so its 15 s can never stretch; this attempt survives a
  // cough instead, so it counts EVERY frame -- noise buys no extra time. The
  // timeout is only applied outside an utterance, so speech that begins at
  // 14.9 s is not cut off mid-word (maxRecordingMs bounds it instead).
  let elapsedFrames = 0;
  let speechRun = 0;

  // Per utterance, from onset.
  let speechFrames = 0;
  let silenceRun = 0;
  let recordedFrames = 0;

  const clampFloor = (value: number): number =>
    Math.min(config.maxNoiseFloorDb, Math.max(config.minNoiseFloorDb, value));

  const startThreshold = (): number => Math.max(config.absoluteFloorDb, floor + config.startMarginDb);
  const continueThreshold = (): number =>
    Math.max(config.absoluteFloorDb, floor + config.continueMarginDb);

  const finish = (reason: EndpointReason, submit: boolean): EndpointDecision => {
    state = 'done';
    return { reason, submit };
  };

  const push = (raw: number): EndpointDecision | null => {
    if (state === 'done') return null;

    // A non-finite level (log of zero, a broken analyser) is silence.
    const level = Number.isFinite(raw) ? raw : config.minNoiseFloorDb;
    elapsedFrames += 1;

    if (state === 'calibrating') {
      calibration.push(level);

      if (calibration.length >= calibrationFrames) {
        floor = clampFloor(median(calibration));
        state = 'waiting';
      }

      return elapsedFrames >= maxWaitFrames ? finish('no_speech', false) : null;
    }

    if (state === 'waiting') {
      if (level >= startThreshold()) {
        speechRun += 1;
      } else {
        speechRun = 0;
        floor = clampFloor(floor + (level - floor) * (level < floor ? FLOOR_FALL : FLOOR_RISE));
      }

      if (speechRun >= config.startFrames) {
        state = 'speaking';
        speechFrames = speechRun;
        recordedFrames = speechRun;
        silenceRun = 0;
        speechRun = 0;
        return null;
      }

      return elapsedFrames >= maxWaitFrames ? finish('no_speech', false) : null;
    }

    // speaking
    recordedFrames += 1;

    if (level >= continueThreshold()) {
      speechFrames += 1;
      silenceRun = 0;
    } else {
      silenceRun += 1;

      if (silenceRun >= endSilenceFrames) {
        if (speechFrames >= minSpeechFrames) return finish('speech_ended', true);

        // A cough, a door, a chair: too short to be a word. Not an
        // utterance, and not the end of the attempt either -- keep waiting
        // for real speech within the same no-speech budget.
        state = 'waiting';
        speechFrames = 0;
        silenceRun = 0;
        recordedFrames = 0;
        return elapsedFrames >= maxWaitFrames ? finish('no_speech', false) : null;
      }
    }

    if (recordedFrames >= maxRecordingFrames) {
      return speechFrames >= minSpeechFrames
        ? finish('max_duration', true)
        : finish('no_speech', false);
    }

    return null;
  };

  return {
    push,
    get state() {
      return state;
    },
  };
}

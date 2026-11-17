import { describe, expect, it } from 'vitest';
import { createSpeechDetector, DEFAULT_ENDPOINTING, type EndpointDecision } from './speechDetector';

/**
 * The end-of-speech state machine, fed scripted levels frame by frame.
 *
 * Frame counts are derived from the configuration rather than hard-coded,
 * so these read as the CLI recorder's rules: 32 ms frames, 300 ms minimum
 * speech, 800 ms end silence, 15 s no-speech, 30 s maximum from onset.
 */

const FRAME = DEFAULT_ENDPOINTING.frameMs;
const frames = (ms: number) => Math.max(1, Math.round(ms / FRAME));

const CALIBRATION = frames(DEFAULT_ENDPOINTING.calibrationMs); // 5
const MIN_SPEECH = frames(DEFAULT_ENDPOINTING.minSpeechMs); // 9
const END_SILENCE = frames(DEFAULT_ENDPOINTING.endSilenceMs); // 25
const NO_SPEECH = frames(DEFAULT_ENDPOINTING.noSpeechTimeoutMs); // 469
const MAX_RECORDING = frames(DEFAULT_ENDPOINTING.maxRecordingMs); // 938

/** A quiet room and a voice well above it, in dBFS. */
const QUIET = -70;
const SPEECH = -30;

const repeat = (level: number, count: number) => Array.from({ length: count }, () => level);

/** Feeds levels until the first decision. Returns it and the 1-based frame it came on. */
function run(levels: number[]) {
  const detector = createSpeechDetector();
  for (let i = 0; i < levels.length; i += 1) {
    const decision = detector.push(levels[i]);
    if (decision) return { decision, frame: i + 1, detector };
  }
  return { decision: null as EndpointDecision | null, frame: null as number | null, detector };
}

describe('createSpeechDetector', () => {
  it('derives its windows from the CLI recorder timings', () => {
    expect([CALIBRATION, MIN_SPEECH, END_SILENCE, NO_SPEECH, MAX_RECORDING]).toEqual([
      5, 9, 25, 469, 938,
    ]);
  });

  describe('a valid utterance', () => {
    it('ends exactly when 800 ms of silence follows enough speech, and submits', () => {
      const lead = repeat(QUIET, 10);
      const speech = repeat(SPEECH, 20); // 640 ms
      const { decision, frame } = run([...lead, ...speech, ...repeat(QUIET, 100)]);

      expect(decision).toEqual({ reason: 'speech_ended', submit: true });
      // The 25th silent frame after speech, not one frame earlier.
      expect(frame).toBe(lead.length + speech.length + END_SILENCE);
    });

    it('does not end on a pause shorter than 800 ms', () => {
      const { decision } = run([
        ...repeat(QUIET, 10),
        ...repeat(SPEECH, 12),
        ...repeat(QUIET, END_SILENCE - 1), // "I want to withdraw ... money"
        ...repeat(SPEECH, 12),
      ]);

      expect(decision).toBeNull();
    });

    it('decides once: every later frame returns null', () => {
      const { detector } = run([...repeat(QUIET, 10), ...repeat(SPEECH, 20), ...repeat(QUIET, 30)]);

      expect(detector.state).toBe('done');
      for (const level of [SPEECH, QUIET, SPEECH]) expect(detector.push(level)).toBeNull();
    });

    it('holds a word together across soft sounds (hysteresis)', () => {
      // A -50 dB room, so the margins -- not the -55 dB absolute floor --
      // set the thresholds: start at -35, continue at -41. -38 is between:
      // not loud enough to START a turn, loud enough to keep one going.
      const room = -50;
      const soft = -38;

      const held = run([...repeat(room, 10), ...repeat(-30, 4), ...repeat(soft, END_SILENCE + 10)]);
      expect(held.decision).toBeNull();
      expect(held.detector.state).toBe('speaking');

      const neverStarted = run([...repeat(room, 10), ...repeat(soft, 60)]);
      expect(neverStarted.detector.state).toBe('waiting');
    });
  });

  describe('speech shorter than 300 ms', () => {
    it('is rejected, and listening continues instead of submitting', () => {
      const burst = MIN_SPEECH - 3; // ~190 ms: a cough
      const { decision, detector } = run([
        ...repeat(QUIET, 10),
        ...repeat(SPEECH, burst),
        ...repeat(QUIET, END_SILENCE + 5),
      ]);

      expect(decision).toBeNull();
      expect(detector.state).toBe('waiting');
    });

    it('lets real speech after a rejected burst still submit', () => {
      const { decision } = run([
        ...repeat(QUIET, 10),
        ...repeat(SPEECH, 3),
        ...repeat(QUIET, END_SILENCE + 5),
        ...repeat(SPEECH, 20),
        ...repeat(QUIET, END_SILENCE),
      ]);

      expect(decision).toEqual({ reason: 'speech_ended', submit: true });
    });

    it('submits at exactly the minimum, and not one frame under it', () => {
      const at = run([...repeat(QUIET, 10), ...repeat(SPEECH, MIN_SPEECH), ...repeat(QUIET, END_SILENCE)]);
      const under = run([
        ...repeat(QUIET, 10),
        ...repeat(SPEECH, MIN_SPEECH - 1),
        ...repeat(QUIET, END_SILENCE),
      ]);

      expect(at.decision?.submit).toBe(true);
      expect(under.decision).toBeNull();
    });
  });

  describe('no speech', () => {
    it('gives up after 15 s and never submits', () => {
      const { decision, frame } = run(repeat(QUIET, NO_SPEECH + 50));

      expect(decision).toEqual({ reason: 'no_speech', submit: false });
      expect(frame).toBe(NO_SPEECH);
    });

    it('gives rejected bursts no extra time: 15 s from the start of the attempt', () => {
      const levels: number[] = [];
      while (levels.length < NO_SPEECH + 200) levels.push(...repeat(SPEECH, 3), ...repeat(QUIET, 40));

      const { decision, frame } = run(levels);

      expect(decision).toEqual({ reason: 'no_speech', submit: false });
      // Decided at the first frame outside an utterance once 15 s are up.
      expect(frame).toBeGreaterThanOrEqual(NO_SPEECH);
      expect(frame).toBeLessThan(NO_SPEECH + 40);
    });

    it('does not cut off speech that begins just before the timeout', () => {
      const { decision } = run([
        ...repeat(QUIET, NO_SPEECH - 3),
        ...repeat(SPEECH, 20),
        ...repeat(QUIET, END_SILENCE),
      ]);

      expect(decision).toEqual({ reason: 'speech_ended', submit: true });
    });
  });

  describe('maximum duration', () => {
    it('stops 30 s after speech onset and submits', () => {
      const lead = repeat(QUIET, 10);
      const { decision, frame } = run([...lead, ...repeat(SPEECH, MAX_RECORDING + 100)]);

      expect(decision).toEqual({ reason: 'max_duration', submit: true });
      // Onset is the second speech frame; it already counts two recorded frames.
      expect(frame).toBe(lead.length + MAX_RECORDING);
    });
  });

  describe('background noise', () => {
    it('does not mistake a steady fan for speech', () => {
      const fan = -45; // above the absolute floor, but constant
      const { decision, frame } = run(repeat(fan, NO_SPEECH + 10));

      // The floor learns the fan; nothing starts, so the attempt simply times out.
      expect(decision).toEqual({ reason: 'no_speech', submit: false });
      expect(frame).toBe(NO_SPEECH);
    });

    it('still hears a voice over that fan', () => {
      const { decision } = run([
        ...repeat(-45, 20),
        ...repeat(-25, 20),
        ...repeat(-45, END_SILENCE),
      ]);

      expect(decision).toEqual({ reason: 'speech_ended', submit: true });
    });

    it('ignores isolated clicks (one loud frame at a time)', () => {
      const levels: number[] = [];
      while (levels.length < 400) levels.push(SPEECH, ...repeat(QUIET, 9));

      expect(run(levels).decision).toBeNull();
    });

    it('never treats sound below the absolute floor as speech, however quiet the room', () => {
      // Digital silence drives the floor to its minimum; -60 dBFS would be
      // +30 dB above it, but is still below the -55 dBFS absolute floor.
      const { decision } = run([...repeat(-100, 10), ...repeat(-60, NO_SPEECH)]);

      expect(decision).toEqual({ reason: 'no_speech', submit: false });
    });

    it('treats a non-finite level as silence', () => {
      const { decision } = run([
        ...repeat(QUIET, 10),
        ...repeat(SPEECH, 20),
        ...repeat(Number.NEGATIVE_INFINITY, END_SILENCE),
      ]);

      expect(decision).toEqual({ reason: 'speech_ended', submit: true });
    });
  });

  describe('a microphone warming up', () => {
    // A real room (-50 dBFS) after two frames of digital silence. The mean
    // of those five calibration frames was -70 dBFS, so the room itself
    // cleared the -55 dBFS start threshold and "speech" never ended.
    const ROOM = -50;
    const warmUp = [-100, -100];

    it('calibrates on the room, not on the silent first frames', () => {
      const { decision } = run([...warmUp, ...repeat(ROOM, NO_SPEECH)]);

      // The room is learned as the floor: nothing starts, nothing submits.
      expect(decision).toEqual({ reason: 'no_speech', submit: false });
    });

    it('still ends the utterance by itself after 800 ms of silence', () => {
      const lead = [...warmUp, ...repeat(ROOM, 30)];
      const speech = repeat(-25, 47); // 1.5 s
      const { decision, frame } = run([...lead, ...speech, ...repeat(ROOM, 200)]);

      expect(decision).toEqual({ reason: 'speech_ended', submit: true });
      expect(frame).toBe(lead.length + speech.length + END_SILENCE);
    });
  });

  it('does not detect during calibration', () => {
    // Speech from the first frame calibrates the floor high; a later voice
    // at the same level is then not 15 dB above it.
    const { decision } = run(repeat(SPEECH, 60));

    expect(decision).toBeNull();
  });
});

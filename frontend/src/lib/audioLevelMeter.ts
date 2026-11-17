/**
 * Measures how loud the microphone is, in the browser, with Web Audio.
 *
 * Nothing is recorded or kept here: the analyser reads a short window of
 * samples, reduces it to one number (RMS level in dBFS), and the samples
 * are overwritten on the next read. The audio itself is captured by
 * MediaRecorder exactly as before.
 *
 * TWO-STEP LIFECYCLE, BECAUSE OF AUTOPLAY POLICY
 *
 * A browser suspends an AudioContext created outside a user gesture, and a
 * suspended context hears only silence. The microphone hook awaits
 * getUserMedia before it has a stream, which ends the gesture. So the
 * context is created first, synchronously inside the tap (prepare), and the
 * stream is attached afterwards (attach).
 *
 * read() returns null whenever the meter cannot actually hear -- context not
 * running, nothing attached, closed, or no audio delivered yet. Null is
 * "unknown", never "silent": the caller must not treat an unmeasurable
 * microphone as a customer who said nothing.
 *
 * A freshly attached analyser's window is zero-filled until the microphone
 * starts delivering samples. Those first reads are pure digital silence that
 * no real room produces; reported as -100 dBFS they dragged the speech
 * detector's calibrated noise floor down, so ordinary room noise then cleared
 * the speech threshold and end-of-speech was never detected. They are
 * reported as null until the first window that carries any signal.
 */

export interface LevelMeter {
  /** Connects the microphone stream. False when it cannot be analysed. */
  attach: (stream: MediaStream) => boolean;
  /** The current level in dBFS, or null when it cannot be measured. */
  read: () => number | null;
  /** Disconnects every node and closes the context. Safe to call twice. */
  close: () => void;
}

export type LevelMeterFactory = () => LevelMeter | null;

/** dBFS reported for a window of pure digital silence. */
export const SILENCE_DB = -100;

/** RMS level of a sample window in dBFS, floored at SILENCE_DB. */
export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return SILENCE_DB;

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];

  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;
}

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;

  const candidate =
    (window as unknown as { AudioContext?: AudioContextConstructor }).AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;

  return typeof candidate === 'function' ? candidate : null;
}

/**
 * The production meter. Returns null when this browser has no Web Audio,
 * in which case recording simply stays tap-to-stop.
 */
export const createWebAudioLevelMeter: LevelMeterFactory = () => {
  const Context = audioContextConstructor();
  if (!Context) return null;

  let context: AudioContext;

  try {
    context = new Context();
  } catch {
    return null;
  }

  // Inside the gesture: the one moment a suspended context may be resumed.
  if (context.state === 'suspended') void context.resume?.().catch(() => undefined);

  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let buffer: Float32Array<ArrayBuffer> | null = null;
  let closed = false;
  // False until the microphone has delivered any signal at all.
  let heard = false;

  return {
    attach(stream) {
      if (closed) return false;

      try {
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        // ~43 ms at 48 kHz: longer than one 32 ms frame, so no sample
        // between two reads goes unmeasured.
        analyser.fftSize = 2048;
        buffer = new Float32Array(analyser.fftSize);
        // Analysis only. Never connected to the destination, so the
        // customer does not hear themselves through the speakers.
        source.connect(analyser);
        return true;
      } catch {
        return false;
      }
    },

    read() {
      if (closed || !analyser || !buffer || context.state !== 'running') return null;

      analyser.getFloatTimeDomainData(buffer);
      const level = rmsDb(buffer);

      // Still the zero-filled window of a microphone warming up: unknown,
      // not silent. Once anything has been heard, silence is real silence.
      if (!heard && level <= SILENCE_DB) return null;

      heard = true;
      return level;
    },

    close() {
      if (closed) return;
      closed = true;

      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {
        // Already disconnected. Nothing to undo.
      }

      source = null;
      analyser = null;
      buffer = null;

      void context.close?.().catch(() => undefined);
    },
  };
};

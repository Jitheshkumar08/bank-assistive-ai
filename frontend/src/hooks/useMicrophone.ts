import { useCallback, useEffect, useRef, useState } from 'react';
import { createWebAudioLevelMeter, type LevelMeter, type LevelMeterFactory } from '@/lib/audioLevelMeter';
import {
  createSpeechDetector,
  DEFAULT_ENDPOINTING,
  type EndpointingConfig,
  type EndpointReason,
} from '@/lib/speechDetector';

export type MicrophoneStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  /** The customer refused, or the browser is blocking the microphone. */
  | 'denied'
  /** No microphone, or this context cannot record at all. */
  | 'unavailable'
  /** Something else went wrong; retrying is worth a try. */
  | 'error';

/**
 * How the last recording attempt ended.
 *
 * `speech_ended` and `max_duration` were submitted by end-of-speech
 * detection; `manual` by the customer's own stop. `no_speech` was dropped
 * without reaching speech recognition: silence is never a turn.
 */
export type RecordingEnd = EndpointReason | 'manual' | 'cancelled' | 'error';

export interface UseMicrophoneOptions {
  /**
   * Receives a completed recording.
   *
   * Called once per utterance: when the customer stops deliberately, or
   * when end-of-speech detection decides they have finished. A cancelled
   * recording, or one in which nothing was said, never reaches here.
   */
  onRecorded: (recording: { blob: Blob; mimeType: string }) => void;
  /**
   * End-of-speech detection. Defaults to the language engine's CLI timings
   * (see lib/speechDetector). `false` turns it off: tap-to-stop only.
   */
  endpointing?: Partial<EndpointingConfig> | false;
  /**
   * Source of microphone levels. Defaults to Web Audio; a browser without
   * it gets null and stays tap-to-stop. Injectable so tests can script
   * levels without a microphone.
   */
  createLevelMeter?: LevelMeterFactory;
}

export interface Microphone {
  status: MicrophoneStatus;
  message: string | null;
  isRecording: boolean;
  /** How the most recent attempt ended; null before any has, or while one runs. */
  lastEnd: RecordingEnd | null;
  /** Asks for permission if needed, then starts recording. */
  start: () => Promise<void>;
  /** Finishes the recording and emits the audio. */
  stop: () => void;
  /** Abandons the recording. Nothing is emitted. */
  cancel: () => void;
  /** Clears a failure so the customer can deliberately try again. */
  retry: () => void;
  /**
   * The latest measured input level in dBFS, or null when nothing is being
   * measured. A read, not state: polling it never re-renders anything.
   */
  readLevel: () => number | null;
}

/**
 * Candidate container formats, best first.
 *
 * Chromium records Opus in WebM; Safari only offers MP4/AAC, and
 * hard-coding WebM is the usual reason voice silently fails on an
 * iPhone. The empty string at the end means "let the browser choose",
 * which is better than refusing to record at all.
 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  '',
];

function selectMimeType(): string {
  const recorder = window.MediaRecorder;

  // isTypeSupported is absent on some older implementations. Without it
  // the only safe move is the browser default.
  if (typeof recorder?.isTypeSupported !== 'function') return '';

  return MIME_CANDIDATES.find((type) => type === '' || recorder.isTypeSupported(type)) ?? '';
}

interface Failure {
  status: MicrophoneStatus;
  message: string;
}

/**
 * Turns a capture error into something worth showing a customer.
 *
 * Mirrors the QR scanner's mapping, deliberately: the two hooks fail in
 * the same ways and should read the same way. Anything unrecognised is
 * retryable rather than terminal -- a dead end is the worst outcome for
 * someone standing in a bank.
 */
function describeFailure(error: unknown): Failure {
  const name = error instanceof DOMException ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        status: 'denied',
        message:
          'Microphone access is blocked. Allow the microphone in your browser settings, or carry on typing instead.',
      };

    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return {
        status: 'unavailable',
        message: 'No microphone was found on this device. You can carry on typing instead.',
      };

    case 'NotReadableError':
    case 'TrackStartError':
      return {
        status: 'error',
        message:
          'The microphone is being used by another app. Close it and try again, or carry on typing.',
      };

    default:
      return {
        status: 'error',
        message: 'The microphone could not be started. Try again, or carry on typing.',
      };
  }
}

export function useMicrophone({
  onRecorded,
  endpointing,
  createLevelMeter = createWebAudioLevelMeter,
}: UseMicrophoneOptions): Microphone {
  const [status, setStatus] = useState<MicrophoneStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastEnd, setLastEnd] = useState<RecordingEnd | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const meterRef = useRef<LevelMeter | null>(null);
  const analysisRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The level end-of-speech detection last measured, for display only.
  const levelRef = useRef<number | null>(null);

  /**
   * The attempt whose recorder has already been asked to stop.
   *
   * MediaRecorder.stop() finishes asynchronously. Without this, a tap
   * landing between an automatic stop and its onstop would see an
   * inactive recorder, release it, and detach the onstop that carries the
   * audio -- losing the utterance. A second stop for the same attempt is
   * simply ignored.
   */
  const finishingRef = useRef(0);

  // Read at start(), so a re-render never restarts a recording.
  const endpointingRef = useRef(endpointing);
  endpointingRef.current = endpointing;
  const createLevelMeterRef = useRef(createLevelMeter);
  createLevelMeterRef.current = createLevelMeter;

  /**
   * Identifies the current recording attempt.
   *
   * MediaRecorder events arrive asynchronously, so a recorder that was
   * cancelled can still fire onstop afterwards. Every handler compares
   * against this, and a stale attempt does nothing at all.
   */
  const runRef = useRef(0);
  /** Set when a recording is abandoned, so its audio is never emitted. */
  const discardRef = useRef(false);

  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  /** Stops level analysis and frees its audio graph. Safe to call repeatedly. */
  const stopAnalysis = useCallback((): void => {
    if (analysisRef.current !== null) {
      clearInterval(analysisRef.current);
      analysisRef.current = null;
    }

    meterRef.current?.close();
    meterRef.current = null;
    levelRef.current = null;
  }, []);

  /** Releases the microphone. Safe to call repeatedly. */
  const release = useCallback((): void => {
    stopAnalysis();

    const recorder = recorderRef.current;

    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;

      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Already stopped, or stopped by the browser. Nothing to undo.
      }
    }

    recorderRef.current = null;
    chunksRef.current = [];

    // The recording indicator stays lit until every track is stopped,
    // which customers notice and rightly distrust.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopAnalysis]);

  /** Abandons the current attempt. Nothing is emitted. */
  const abandon = useCallback(
    (reason: RecordingEnd): void => {
      runRef.current += 1;
      discardRef.current = true;

      release();
      setStatus('idle');
      setLastEnd(reason);
    },
    [release],
  );

  const cancel = useCallback((): void => abandon('cancelled'), [abandon]);

  /** Asks the recorder to finish; its onstop emits the audio once. */
  const finish = useCallback(
    (reason: RecordingEnd): void => {
      const run = runRef.current;
      const recorder = recorderRef.current;

      // Already finishing this attempt: a second request must not race it.
      if (finishingRef.current === run) return;

      stopAnalysis();

      if (!recorder || recorder.state === 'inactive') {
        release();
        setStatus('idle');
        return;
      }

      finishingRef.current = run;
      discardRef.current = false;
      setLastEnd(reason);

      try {
        // onstop builds the Blob and emits it.
        recorder.stop();
      } catch {
        release();
        setStatus('idle');
      }
    },
    [release, stopAnalysis],
  );

  const retry = useCallback((): void => {
    setStatus('idle');
    setMessage(null);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    // A refusal is not retried silently. The customer has to ask again,
    // which is what retry() is for.
    if (status === 'denied' || status === 'unavailable') return;
    if (status === 'starting' || status === 'recording') return;

    const run = ++runRef.current;
    discardRef.current = false;

    setStatus('starting');
    setMessage(null);
    setLastEnd(null);

    // getUserMedia is only exposed over HTTPS or on localhost.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setStatus('unavailable');
      setMessage(
        'The microphone needs a secure (https) connection. You can carry on typing instead.',
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setMessage('This browser cannot use the microphone. You can carry on typing instead.');
      return;
    }

    if (typeof window.MediaRecorder !== 'function') {
      setStatus('unavailable');
      setMessage('This browser cannot record audio. You can carry on typing instead.');
      return;
    }

    // Created here, before the first await, while this is still the
    // customer's tap: a level meter's audio context made after the gesture
    // would be suspended and hear nothing. Held in meterRef so a cancel or
    // unmount during the permission prompt closes it too.
    const config = endpointingRef.current;
    const meter = config === false ? null : createLevelMeterRef.current();
    meterRef.current = meter;

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      meter?.close();
      if (runRef.current !== run) return;

      meterRef.current = null;
      const failure = describeFailure(error);
      setStatus(failure.status);
      setMessage(failure.message);
      return;
    }

    // Cancelled or unmounted while permission was pending. Release at
    // once rather than leaving the microphone open invisibly.
    if (runRef.current !== run) {
      meter?.close();
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const mimeType = selectMimeType();
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stopAnalysis();
      stream.getTracks().forEach((track) => track.stop());
      setStatus('error');
      setMessage('This browser could not record in a supported format. Please carry on typing.');
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (runRef.current !== run) return;
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      // A stale recorder finishing after a cancel must not resurrect the
      // recording or move the UI.
      if (runRef.current !== run) return;

      const chunks = chunksRef.current;
      const discarded = discardRef.current;

      release();
      setStatus('idle');

      if (discarded || chunks.length === 0) return;

      const type = recorder.mimeType || mimeType || 'audio/webm';
      onRecordedRef.current({ blob: new Blob(chunks, { type }), mimeType: type });
    };

    recorder.onerror = () => {
      if (runRef.current !== run) return;

      release();
      setStatus('error');
      setMessage('Recording stopped unexpectedly. Try again, or carry on typing.');
      setLastEnd('error');
    };

    try {
      recorder.start();
    } catch {
      release();
      setStatus('error');
      setMessage('The microphone could not be started. Try again, or carry on typing.');
      return;
    }

    setStatus('recording');

    // End-of-speech detection. Without a meter -- no Web Audio, or turned
    // off -- recording stays tap-to-stop, exactly as before.
    if (meter && meter.attach(stream)) {
      const detector = createSpeechDetector(config || {});
      const frameMs = (config && config.frameMs) || DEFAULT_ENDPOINTING.frameMs;

      analysisRef.current = setInterval(() => {
        // A timer from a cancelled, finished or unmounted attempt does
        // nothing at all.
        if (runRef.current !== run || finishingRef.current === run) return;

        // Unmeasurable is not silent: a suspended audio context must not
        // turn a customer who is speaking into "nothing was said". Such a
        // frame counts towards nothing, and the manual stop still works.
        const level = meter.read();
        if (level === null) return;

        levelRef.current = level;
        const decision = detector.push(level);
        if (!decision) return;

        if (decision.submit) finish(decision.reason);
        else abandon(decision.reason);
      }, frameMs);
    } else {
      stopAnalysis();
    }
  }, [abandon, finish, release, status, stopAnalysis]);

  /** The customer's own stop: always submits what was recorded. */
  const stop = useCallback((): void => finish('manual'), [finish]);

  const readLevel = useCallback((): number | null => levelRef.current, []);

  // A microphone must never outlive the component that opened it.
  useEffect(() => {
    return () => {
      runRef.current += 1;
      discardRef.current = true;
      release();
    };
  }, [release]);

  return {
    status,
    message,
    isRecording: status === 'recording',
    lastEnd,
    start,
    stop,
    cancel,
    retry,
    readLevel,
  };
}

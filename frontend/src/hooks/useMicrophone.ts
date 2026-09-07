import { useCallback, useEffect, useRef, useState } from 'react';

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

export interface UseMicrophoneOptions {
  /**
   * Receives a completed recording.
   *
   * Only called for a recording the customer finished deliberately. A
   * cancelled one is discarded without ever reaching here.
   */
  onRecorded: (recording: { blob: Blob; mimeType: string }) => void;
}

export interface Microphone {
  status: MicrophoneStatus;
  message: string | null;
  isRecording: boolean;
  /** Asks for permission if needed, then starts recording. */
  start: () => Promise<void>;
  /** Finishes the recording and emits the audio. */
  stop: () => void;
  /** Abandons the recording. Nothing is emitted. */
  cancel: () => void;
  /** Clears a failure so the customer can deliberately try again. */
  retry: () => void;
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

export function useMicrophone({ onRecorded }: UseMicrophoneOptions): Microphone {
  const [status, setStatus] = useState<MicrophoneStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

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

  /** Releases the microphone. Safe to call repeatedly. */
  const release = useCallback((): void => {
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
  }, []);

  const cancel = useCallback((): void => {
    runRef.current += 1;
    discardRef.current = true;

    release();
    setStatus('idle');
  }, [release]);

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

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      if (runRef.current !== run) return;

      const failure = describeFailure(error);
      setStatus(failure.status);
      setMessage(failure.message);
      return;
    }

    // Cancelled or unmounted while permission was pending. Release at
    // once rather than leaving the microphone open invisibly.
    if (runRef.current !== run) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const mimeType = selectMimeType();
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
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
  }, [release, status]);

  const stop = useCallback((): void => {
    const recorder = recorderRef.current;

    if (!recorder || recorder.state === 'inactive') {
      release();
      setStatus('idle');
      return;
    }

    discardRef.current = false;

    try {
      // onstop builds the Blob and emits it.
      recorder.stop();
    } catch {
      release();
      setStatus('idle');
    }
  }, [release]);

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
    start,
    stop,
    cancel,
    retry,
  };
}

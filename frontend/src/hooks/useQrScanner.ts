import { useCallback, useEffect, useRef, useState } from 'react';
import { createFrameDecoder } from '@/lib/qrDecoder';

export type ScannerStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  /** The customer refused, or the browser is blocking the camera. */
  | 'denied'
  /** No camera, or this context cannot use one at all. */
  | 'unavailable'
  /** Something else went wrong; retrying is worth a try. */
  | 'error';

export interface UseQrScannerOptions {
  /** Called with the raw, untrusted contents of a decoded code. */
  onDecode: (raw: string) => void;
  /** Set false to release the camera, e.g. once a code is being submitted. */
  enabled: boolean;
}

export interface QrScanner {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  message: string | null;
  retry: () => void;
}

/** Roughly ten decode attempts a second: responsive without draining a battery. */
const SCAN_INTERVAL_MS = 100;

interface Failure {
  status: ScannerStatus;
  message: string;
}

/**
 * Turns a camera error into something worth showing a customer.
 *
 * Browsers disagree on names, so the mapping is deliberately broad.
 * Anything unrecognised becomes a retryable error rather than a dead
 * end -- the worst outcome is a person standing in a bank with a screen
 * that gives them nothing to do.
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
          'Camera access is blocked. Allow the camera in your browser settings, or enter the code printed under the QR instead.',
      };

    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return {
        status: 'unavailable',
        message:
          'No camera was found on this device. You can enter the code printed under the QR instead.',
      };

    case 'NotReadableError':
    case 'TrackStartError':
      return {
        status: 'error',
        message:
          'The camera is being used by another app. Close it and try again, or enter the code manually.',
      };

    default:
      return {
        status: 'error',
        message: 'The camera could not be started. Try again, or enter the code manually.',
      };
  }
}

export function useQrScanner({ onDecode, enabled }: UseQrScannerOptions): QrScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const decoderRef = useRef<ReturnType<typeof createFrameDecoder> | null>(null);
  const lastScanRef = useRef(0);

  // Held in a ref so the scan loop never restarts just because the page
  // re-rendered with a new callback identity.
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /** Releases the camera. Safe to call repeatedly. */
  const stop = useCallback((): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    // The camera indicator light stays on until every track is stopped,
    // which customers notice and rightly distrust.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const video = videoRef.current;

    if (video) {
      try {
        video.srcObject = null;
      } catch {
        // Older browsers, nothing to release.
      }
    }
  }, []);

  const retry = useCallback((): void => {
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      setStatus('idle');
      return;
    }

    let cancelled = false;

    async function start(): Promise<void> {
      setStatus('starting');
      setMessage(null);

      // getUserMedia is only exposed over HTTPS or on localhost. Saying
      // so is more useful than a generic failure.
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        setStatus('unavailable');
        setMessage(
          'The camera needs a secure (https) connection. You can enter the code printed under the QR instead.',
        );
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        setMessage(
          'This browser cannot use the camera. You can enter the code printed under the QR instead.',
        );
        return;
      }

      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera is the one pointing at the counter.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (error) {
        if (cancelled) return;

        const failure = describeFailure(error);
        setStatus(failure.status);
        setMessage(failure.message);
        return;
      }

      // The effect was torn down while permission was pending. Release
      // immediately rather than leaving the camera running invisibly.
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;

      if (video) {
        try {
          video.srcObject = stream;
          await video.play?.();
        } catch {
          // Autoplay can be refused; the decode loop simply waits until
          // frames are available.
        }
      }

      if (cancelled) return;

      decoderRef.current ??= createFrameDecoder();
      setStatus('scanning');

      const tick = (timestamp: number): void => {
        if (cancelled) return;

        frameRef.current = requestAnimationFrame(tick);

        if (timestamp - lastScanRef.current < SCAN_INTERVAL_MS) return;
        lastScanRef.current = timestamp;

        const element = videoRef.current;
        const decode = decoderRef.current;

        if (!element || !decode) return;

        const raw = decode(element);

        if (raw) onDecodeRef.current(raw);
      };

      frameRef.current = requestAnimationFrame(tick);
    }

    void start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, attempt, stop]);

  // Belt and braces: a camera must never outlive the page that opened it.
  useEffect(() => stop, [stop]);

  return { videoRef, status, message, retry };
}

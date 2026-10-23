import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Microphone,
  MicrophoneStatus,
  RecordingEnd,
  UseMicrophoneOptions,
} from '@/hooks/useMicrophone';
import type { EndpointReason } from '@/lib/speechDetector';

/**
 * A stand-in for useMicrophone.
 *
 * The real hook is covered by its own tests against mocked browser APIs.
 * Anything testing what happens *around* the microphone -- voice state,
 * the overlay, the layout -- uses this instead, so those tests describe
 * integration rather than re-testing getUserMedia.
 *
 * It honours the same contract: start moves to recording, stop emits a
 * recording, cancel emits nothing.
 */
export const fakeMicrophoneControls = {
  /** Set to make the next start() fail the way a real refusal would. */
  failWith: null as { status: MicrophoneStatus; message: string } | null,
  /** Size of the Blob a completed recording produces. */
  blobSize: 2048,
  /** Every start() call, including ones that fail. */
  attempts: 0,
  /** start() calls that actually opened the (fake) microphone. */
  starts: 0,
  /**
   * Ends the live recording the way end-of-speech detection would:
   * 'speech_ended' / 'max_duration' emit it, 'no_speech' drops it. Set while
   * a fake microphone is mounted; a no-op unless it is recording.
   */
  endpoint: null as ((reason: EndpointReason) => void) | null,

  reset() {
    this.failWith = null;
    this.blobSize = 2048;
    this.attempts = 0;
    this.starts = 0;
    this.endpoint = null;
  },
};

export function fakeUseMicrophone({ onRecorded }: UseMicrophoneOptions): Microphone {
  const [status, setStatus] = useState<MicrophoneStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  // Only the deliberate ends: the fake has no speech detection.
  const [lastEnd, setLastEnd] = useState<RecordingEnd | null>(null);

  // Lets stop() read the current status without depending on it.
  const statusRef = useRef(status);
  statusRef.current = status;

  const start = useCallback(async (): Promise<void> => {
    fakeMicrophoneControls.attempts += 1;
    const failure = fakeMicrophoneControls.failWith;

    if (failure) {
      setStatus(failure.status);
      setMessage(failure.message);
      return;
    }

    fakeMicrophoneControls.starts += 1;
    setStatus('recording');
    setMessage(null);
    setLastEnd(null);
  }, []);

  const stop = useCallback((): void => {
    // Emitting from inside a state updater would fire twice under
    // StrictMode. Read the status, then act on it.
    if (statusRef.current !== 'recording') return;

    const type = 'audio/webm';

    setStatus('idle');
    setLastEnd('manual');
    onRecorded({
      blob: new Blob([new Uint8Array(fakeMicrophoneControls.blobSize)], { type }),
      mimeType: type,
    });
  }, [onRecorded]);

  const cancel = useCallback((): void => {
    // Deliberately emits nothing: a cancelled recording is discarded.
    setStatus('idle');
    setLastEnd('cancelled');
  }, []);

  const retry = useCallback((): void => {
    setStatus('idle');
    setMessage(null);
  }, []);

  const endpoint = useCallback(
    (reason: EndpointReason): void => {
      if (statusRef.current !== 'recording') return;

      setStatus('idle');
      setLastEnd(reason);

      // Silence is dropped, never delivered.
      if (reason === 'no_speech') return;

      const type = 'audio/webm';
      onRecorded({
        blob: new Blob([new Uint8Array(fakeMicrophoneControls.blobSize)], { type }),
        mimeType: type,
      });
    },
    [onRecorded],
  );

  useEffect(() => {
    fakeMicrophoneControls.endpoint = endpoint;
    return () => {
      if (fakeMicrophoneControls.endpoint === endpoint) fakeMicrophoneControls.endpoint = null;
    };
  }, [endpoint]);

  return {
    status,
    message,
    isRecording: status === 'recording',
    lastEnd,
    start,
    stop,
    cancel,
    retry,
    // Nothing is measured without a real microphone.
    readLevel: () => null,
  };
}

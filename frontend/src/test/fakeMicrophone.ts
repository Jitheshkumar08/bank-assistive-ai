import { useCallback, useRef, useState } from 'react';
import type { Microphone, MicrophoneStatus, UseMicrophoneOptions } from '@/hooks/useMicrophone';

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

  reset() {
    this.failWith = null;
    this.blobSize = 2048;
  },
};

export function fakeUseMicrophone({ onRecorded }: UseMicrophoneOptions): Microphone {
  const [status, setStatus] = useState<MicrophoneStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  // Lets stop() read the current status without depending on it.
  const statusRef = useRef(status);
  statusRef.current = status;

  const start = useCallback(async (): Promise<void> => {
    const failure = fakeMicrophoneControls.failWith;

    if (failure) {
      setStatus(failure.status);
      setMessage(failure.message);
      return;
    }

    setStatus('recording');
    setMessage(null);
  }, []);

  const stop = useCallback((): void => {
    // Emitting from inside a state updater would fire twice under
    // StrictMode. Read the status, then act on it.
    if (statusRef.current !== 'recording') return;

    const type = 'audio/webm';

    setStatus('idle');
    onRecorded({
      blob: new Blob([new Uint8Array(fakeMicrophoneControls.blobSize)], { type }),
      mimeType: type,
    });
  }, [onRecorded]);

  const cancel = useCallback((): void => {
    // Deliberately emits nothing: a cancelled recording is discarded.
    setStatus('idle');
  }, []);

  const retry = useCallback((): void => {
    setStatus('idle');
    setMessage(null);
  }, []);

  return { status, message, isRecording: status === 'recording', start, stop, cancel, retry };
}

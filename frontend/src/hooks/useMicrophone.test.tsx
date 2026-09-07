import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMicrophone } from './useMicrophone';

/**
 * A controllable MediaRecorder.
 *
 * jsdom has none, and these tests must never depend on a physical
 * microphone. Handlers are kept reachable so a late browser callback can
 * be simulated after the hook has torn the recorder down.
 */
class FakeMediaRecorder {
  static supported: string[] = ['audio/webm;codecs=opus', 'audio/webm'];
  static constructorThrows = false;
  static last: FakeMediaRecorder | null = null;

  static isTypeSupported = vi.fn((type: string) => FakeMediaRecorder.supported.includes(type));

  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  startThrows = false;

  stream: MediaStream;
  options?: { mimeType?: string };

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    if (FakeMediaRecorder.constructorThrows) throw new Error('unsupported format');

    this.stream = stream;
    this.options = options;
    FakeMediaRecorder.last = this;
  }

  get mimeType(): string {
    return this.options?.mimeType ?? '';
  }

  start(): void {
    if (this.startThrows) throw new Error('cannot start');
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    // The browser delivers the audio, then signals completion.
    this.ondataavailable?.({ data: new Blob([new Uint8Array(1024)]) });
    this.onstop?.();
  }

  /** Fires onstop without going through stop(), as a late event would. */
  fireLateStop(handler: (() => void) | null): void {
    handler?.();
  }
}

function fakeStream() {
  const stop = vi.fn();
  const track = { stop, kind: 'audio' };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, stop };
}

function setGetUserMedia(impl: (() => Promise<MediaStream>) | undefined) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: impl ? { getUserMedia: vi.fn(impl) } : undefined,
  });
}

function setMediaRecorder(value: unknown) {
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value });
}

const domError = (name: string) => new DOMException('refused by test', name);

/** Typed so the hook's option signature is actually checked. */
const makeOnRecorded = () => vi.fn<(recording: { blob: Blob; mimeType: string }) => void>();

describe('useMicrophone', () => {
  let onRecorded: ReturnType<typeof makeOnRecorded>;

  beforeEach(() => {
    onRecorded = makeOnRecorded();
    FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm'];
    FakeMediaRecorder.constructorThrows = false;
    FakeMediaRecorder.last = null;
    FakeMediaRecorder.isTypeSupported.mockClear();
    setMediaRecorder(FakeMediaRecorder);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const render = () => renderHook(() => useMicrophone({ onRecorded }));

  it('starts idle and silent', () => {
    setGetUserMedia(() => Promise.resolve(fakeStream().stream));

    const { result } = render();

    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBeNull();
    expect(result.current.isRecording).toBe(false);
  });

  describe('when the browser cannot record', () => {
    it('reports a browser with no camera or microphone API', async () => {
      setGetUserMedia(undefined);

      const { result } = render();
      await act(() => result.current.start());

      expect(result.current.status).toBe('unavailable');
      expect(result.current.message).toMatch(/cannot use the microphone/i);
    });

    it('reports a browser without MediaRecorder', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));
      setMediaRecorder(undefined);

      const { result } = render();
      await act(() => result.current.start());

      expect(result.current.status).toBe('unavailable');
      expect(result.current.message).toMatch(/cannot record audio/i);
    });

    it('explains an insecure connection rather than failing vaguely', async () => {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());

      expect(result.current.status).toBe('unavailable');
      expect(result.current.message).toMatch(/secure/i);
    });

    it('releases the stream when the recorder cannot be constructed', async () => {
      const { stream, stop } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));
      FakeMediaRecorder.constructorThrows = true;

      const { result } = render();
      await act(() => result.current.start());

      expect(result.current.status).toBe('error');
      // Permission was granted, so a stream exists and must not leak.
      expect(stop).toHaveBeenCalled();
    });
  });

  describe('permission', () => {
    it('records once permission is granted', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());

      expect(result.current.status).toBe('recording');
      expect(result.current.isRecording).toBe(true);
    });

    it('asks for audio only, never the camera', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: true,
        video: false,
      });
    });

    it.each([
      ['NotAllowedError', 'denied', /blocked/i],
      ['NotFoundError', 'unavailable', /no microphone/i],
      ['NotReadableError', 'error', /another app/i],
    ])('maps %s to %s', async (name, status, pattern) => {
      setGetUserMedia(() => Promise.reject(domError(name)));

      const { result } = render();
      await act(() => result.current.start());

      expect(result.current.status).toBe(status);
      expect(result.current.message).toMatch(pattern);
      // Never a dead end: typing is always still available.
      expect(result.current.message).toMatch(/typing/i);
    });

    it('treats an unrecognised failure as retryable', async () => {
      setGetUserMedia(() => Promise.reject(new Error('something odd')));

      const { result } = render();
      await act(() => result.current.start());

      expect(result.current.status).toBe('error');
    });

    it('does not ask again after a refusal without an explicit retry', async () => {
      setGetUserMedia(() => Promise.reject(domError('NotAllowedError')));

      const { result } = render();
      await act(() => result.current.start());
      expect(result.current.status).toBe('denied');

      await act(() => result.current.start());

      // Still one prompt: re-asking on every tap is how browsers end up
      // blocking a site permanently.
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('allows a fresh attempt after retry', async () => {
      setGetUserMedia(() => Promise.reject(domError('NotAllowedError')));

      const { result } = render();
      await act(() => result.current.start());

      const { stream } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));

      act(() => result.current.retry());
      expect(result.current.status).toBe('idle');
      expect(result.current.message).toBeNull();

      await act(() => result.current.start());
      expect(result.current.status).toBe('recording');
    });
  });

  describe('producing a recording', () => {
    it('emits a Blob when the customer stops deliberately', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());
      act(() => result.current.stop());

      await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));

      const recording = onRecorded.mock.calls[0][0];
      expect(recording.blob).toBeInstanceOf(Blob);
      expect(recording.blob.size).toBeGreaterThan(0);
      expect(recording.mimeType).toMatch(/^audio\//);
      expect(result.current.status).toBe('idle');
    });

    it('picks a MIME type the browser actually supports', async () => {
      FakeMediaRecorder.supported = ['audio/mp4'];
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());

      // Safari offers only MP4; hard-coding WebM is why voice silently
      // fails on iPhones.
      expect(FakeMediaRecorder.last?.options?.mimeType).toBe('audio/mp4');
    });

    it('falls back to the browser default when nothing is recognised', async () => {
      FakeMediaRecorder.supported = [];
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());

      expect(FakeMediaRecorder.last?.options).toBeUndefined();
      expect(result.current.status).toBe('recording');
    });

    it('releases the microphone once the recording is finished', async () => {
      const { stream, stop } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));

      const { result } = render();
      await act(() => result.current.start());
      act(() => result.current.stop());

      await waitFor(() => expect(stop).toHaveBeenCalled());
    });

    it('reports a recorder that fails mid-recording', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());

      act(() => FakeMediaRecorder.last?.onerror?.());

      expect(result.current.status).toBe('error');
      expect(onRecorded).not.toHaveBeenCalled();
    });
  });

  describe('cancelling', () => {
    it('discards the audio and releases the microphone', async () => {
      const { stream, stop } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));

      const { result } = render();
      await act(() => result.current.start());
      act(() => result.current.cancel());

      // Turning voice off mid-sentence must not deliver what was said.
      expect(onRecorded).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
      expect(result.current.status).toBe('idle');
    });

    it('ignores a late recorder callback after cancelling', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = render();
      await act(() => result.current.start());

      const recorder = FakeMediaRecorder.last!;
      const lateHandler = recorder.onstop;

      act(() => result.current.cancel());
      // The browser can still deliver onstop after teardown.
      act(() => recorder.fireLateStop(lateHandler));

      expect(onRecorded).not.toHaveBeenCalled();
      expect(result.current.status).toBe('idle');
    });
  });

  describe('unmounting', () => {
    it('stops every track when the component goes away', async () => {
      const { stream, stop } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));

      const { result, unmount } = render();
      await act(() => result.current.start());

      unmount();

      // No microphone may outlive the page that opened it.
      expect(stop).toHaveBeenCalled();
    });

    it('emits nothing after unmounting', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result, unmount } = render();
      await act(() => result.current.start());

      const recorder = FakeMediaRecorder.last!;
      const lateHandler = recorder.onstop;
      unmount();
      recorder.fireLateStop(lateHandler);

      expect(onRecorded).not.toHaveBeenCalled();
    });

    it('releases a stream granted after the component has gone', async () => {
      const { stream, stop } = fakeStream();
      let grant!: (value: MediaStream) => void;
      setGetUserMedia(() => new Promise<MediaStream>((resolve) => (grant = resolve)));

      const { result, unmount } = render();
      act(() => void result.current.start());

      unmount();
      // Permission was still pending when the customer navigated away.
      await act(async () => {
        grant(stream);
        await Promise.resolve();
      });

      expect(stop).toHaveBeenCalled();
    });
  });
});

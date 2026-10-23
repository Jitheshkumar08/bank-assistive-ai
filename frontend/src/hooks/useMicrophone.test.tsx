import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LevelMeter } from '@/lib/audioLevelMeter';
import { DEFAULT_ENDPOINTING, type EndpointingConfig } from '@/lib/speechDetector';
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
  static instances = 0;
  /**
   * When set, onstop arrives this many ms after stop(), as it does in a
   * real browser. Null keeps the original synchronous behaviour.
   */
  static asyncStopMs: number | null = null;

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
    FakeMediaRecorder.instances += 1;
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

    // The browser delivers the audio, then signals completion. Handlers
    // are read at delivery time, so a teardown in between is honoured.
    const deliver = () => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(1024)]) });
      this.onstop?.();
    };

    if (FakeMediaRecorder.asyncStopMs === null) deliver();
    else setTimeout(deliver, FakeMediaRecorder.asyncStopMs);
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
    FakeMediaRecorder.instances = 0;
    FakeMediaRecorder.asyncStopMs = null;
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

  /**
   * End-of-speech detection, driven by a scripted level meter.
   *
   * The detector, the hook's timers and its teardown are all real; only
   * the microphone LEVEL is scripted, one reading per 32 ms frame. Nothing
   * here says how a real microphone in a real room behaves.
   */
  describe('end-of-speech detection', () => {
    const FRAME = DEFAULT_ENDPOINTING.frameMs;
    const QUIET = -70;
    const SPEECH = -30;

    /** Frame (1-based) on which a turn of `lead` quiet + `speech` frames ends. */
    const endFrame = (lead: number, speech: number) => lead + speech + 25;

    function scriptedMeter(script: (frame: number) => number | null, attaches = true) {
      let frame = 0;
      return {
        attach: vi.fn(() => attaches),
        read: vi.fn(() => script(frame++)),
        close: vi.fn(),
      } satisfies LevelMeter;
    }

    /** `lead` quiet frames, `speech` frames of speech, then quiet. */
    const utterance = (lead: number, speech: number) => (f: number) =>
      f >= lead && f < lead + speech ? SPEECH : QUIET;

    let tracks: ReturnType<typeof fakeStream>;

    beforeEach(() => {
      // Promises stay real, so start() still resolves normally.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
      tracks = fakeStream();
      setGetUserMedia(() => Promise.resolve(tracks.stream));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function renderWith(meter: LevelMeter | null, endpointing?: Partial<EndpointingConfig> | false) {
      const factory = vi.fn(() => meter);
      const hook = renderHook(() =>
        useMicrophone({ onRecorded, createLevelMeter: factory, endpointing }),
      );
      return { ...hook, factory };
    }

    const advance = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    it('submits exactly once when 800 ms of silence follows speech', async () => {
      const meter = scriptedMeter(utterance(10, 20));
      const { result } = renderWith(meter);
      await act(() => result.current.start());

      advance(endFrame(10, 20) * FRAME - 1);
      expect(onRecorded).not.toHaveBeenCalled();
      expect(result.current.status).toBe('recording');

      advance(2);
      expect(onRecorded).toHaveBeenCalledTimes(1);
      expect(onRecorded.mock.calls[0][0].mimeType).toMatch(/^audio\//);
      expect(result.current.lastEnd).toBe('speech_ended');
      expect(result.current.status).toBe('idle');
      expect(tracks.stop).toHaveBeenCalled();
      expect(meter.close).toHaveBeenCalled();

      const reads = meter.read.mock.calls.length;
      advance(20_000);
      expect(onRecorded).toHaveBeenCalledTimes(1);
      expect(meter.read.mock.calls.length).toBe(reads);
    });

    it('rejects speech shorter than 300 ms and keeps listening', async () => {
      const { result } = renderWith(scriptedMeter(utterance(10, 5)));
      await act(() => result.current.start());

      advance(3_000);

      expect(onRecorded).not.toHaveBeenCalled();
      expect(result.current.status).toBe('recording');
      expect(result.current.lastEnd).toBeNull();
    });

    it('drops the recording when nothing is said for 15 s, without submitting', async () => {
      const meter = scriptedMeter(() => QUIET);
      const { result } = renderWith(meter);
      await act(() => result.current.start());

      const recorder = FakeMediaRecorder.last!;
      const lateHandler = recorder.onstop;

      advance(14_900);
      expect(result.current.status).toBe('recording');

      advance(200);
      expect(onRecorded).not.toHaveBeenCalled();
      expect(result.current.status).toBe('idle');
      expect(result.current.lastEnd).toBe('no_speech');
      expect(tracks.stop).toHaveBeenCalled();
      expect(meter.close).toHaveBeenCalled();

      // The browser may still deliver the discarded recorder's onstop.
      act(() => recorder.fireLateStop(lateHandler));
      expect(onRecorded).not.toHaveBeenCalled();
    });

    it('stops at 30 s of continuous speech and submits', async () => {
      const { result } = renderWith(scriptedMeter((f) => (f >= 5 ? SPEECH : QUIET)));
      await act(() => result.current.start());

      advance(30_000);
      expect(onRecorded).not.toHaveBeenCalled();
      expect(result.current.status).toBe('recording');

      advance(400);
      expect(onRecorded).toHaveBeenCalledTimes(1);
      expect(result.current.lastEnd).toBe('max_duration');
    });

    it('does not submit on background noise or isolated clicks', async () => {
      // A steady -45 dB fan with a loud one-frame click every 10 frames.
      const { result } = renderWith(scriptedMeter((f) => (f % 10 === 9 ? SPEECH : -45)));
      await act(() => result.current.start());

      advance(10_000);

      expect(onRecorded).not.toHaveBeenCalled();
      expect(result.current.status).toBe('recording');
    });

    it('lets a manual stop submit mid-utterance, once, and stops analysis', async () => {
      const meter = scriptedMeter(utterance(10, 10_000));
      const { result } = renderWith(meter);
      await act(() => result.current.start());
      advance(1_000);

      act(() => result.current.stop());

      expect(onRecorded).toHaveBeenCalledTimes(1);
      expect(result.current.lastEnd).toBe('manual');
      expect(meter.close).toHaveBeenCalled();
      expect(tracks.stop).toHaveBeenCalled();

      const reads = meter.read.mock.calls.length;
      advance(40_000);
      expect(meter.read.mock.calls.length).toBe(reads);
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });

    it('cancels without emitting, and releases every resource', async () => {
      const meter = scriptedMeter(utterance(10, 20));
      const { result } = renderWith(meter);
      await act(() => result.current.start());
      advance(500);

      act(() => result.current.cancel());

      expect(onRecorded).not.toHaveBeenCalled();
      expect(result.current.lastEnd).toBe('cancelled');
      expect(meter.close).toHaveBeenCalled();
      expect(tracks.stop).toHaveBeenCalled();

      const reads = meter.read.mock.calls.length;
      advance(20_000);
      expect(meter.read.mock.calls.length).toBe(reads);
      expect(onRecorded).not.toHaveBeenCalled();
    });

    it('does not lose or duplicate an utterance when a tap lands during an automatic stop', async () => {
      // Real browsers deliver onstop later; a tap can arrive in between.
      FakeMediaRecorder.asyncStopMs = 50;
      const { result } = renderWith(scriptedMeter(utterance(10, 20)));
      await act(() => result.current.start());

      advance(endFrame(10, 20) * FRAME + 1);
      expect(onRecorded).not.toHaveBeenCalled(); // stop requested, audio not yet delivered

      act(() => result.current.stop());
      act(() => result.current.stop());
      advance(100);

      expect(onRecorded).toHaveBeenCalledTimes(1);
      expect(result.current.lastEnd).toBe('speech_ended');
      expect(result.current.status).toBe('idle');
    });

    it('emits nothing and frees the meter when unmounted mid-utterance', async () => {
      const meter = scriptedMeter(utterance(10, 20));
      const { result, unmount } = renderWith(meter);
      await act(() => result.current.start());
      advance(500);

      unmount();

      expect(meter.close).toHaveBeenCalled();
      expect(tracks.stop).toHaveBeenCalled();
      const reads = meter.read.mock.calls.length;
      vi.advanceTimersByTime(20_000);
      expect(meter.read.mock.calls.length).toBe(reads);
      expect(onRecorded).not.toHaveBeenCalled();
    });

    it('opens one recorder and one meter however often start is pressed', async () => {
      const { result, factory } = renderWith(scriptedMeter(() => QUIET));
      await act(() => result.current.start());
      await act(() => result.current.start());

      expect(factory).toHaveBeenCalledTimes(1);
      expect(FakeMediaRecorder.instances).toBe(1);
    });

    it('never discards speech as silence when the level cannot be measured', async () => {
      // e.g. an audio context the browser kept suspended.
      const { result } = renderWith(scriptedMeter(() => null));
      await act(() => result.current.start());

      advance(60_000);
      expect(result.current.status).toBe('recording');
      expect(onRecorded).not.toHaveBeenCalled();

      act(() => result.current.stop());
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });

    it('builds the meter inside the tap, and closes it if cancelled while permission is pending', async () => {
      let grant!: (value: MediaStream) => void;
      setGetUserMedia(() => new Promise<MediaStream>((resolve) => (grant = resolve)));
      const meter = scriptedMeter(() => QUIET);
      const { result, factory } = renderWith(meter);

      act(() => void result.current.start());
      // Before permission resolves: still inside the customer's gesture.
      expect(factory).toHaveBeenCalledTimes(1);

      act(() => result.current.cancel());
      expect(meter.close).toHaveBeenCalled();

      await act(async () => {
        grant(tracks.stream);
        await Promise.resolve();
      });

      expect(tracks.stop).toHaveBeenCalled();
      expect(FakeMediaRecorder.instances).toBe(0);
    });

    it('closes the meter when microphone permission is refused', async () => {
      setGetUserMedia(() => Promise.reject(domError('NotAllowedError')));
      const meter = scriptedMeter(() => QUIET);
      const { result } = renderWith(meter);

      await act(() => result.current.start());

      expect(result.current.status).toBe('denied');
      expect(meter.close).toHaveBeenCalled();
    });

    it('stays tap-to-stop, with no meter, when endpointing is off', async () => {
      const { result, factory } = renderWith(scriptedMeter(() => QUIET), false);
      await act(() => result.current.start());

      advance(60_000);
      expect(factory).not.toHaveBeenCalled();
      expect(result.current.status).toBe('recording');

      act(() => result.current.stop());
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });

    it('stays tap-to-stop when the stream cannot be analysed', async () => {
      const meter = scriptedMeter(() => QUIET, false);
      const { result } = renderWith(meter);
      await act(() => result.current.start());

      expect(meter.close).toHaveBeenCalled();
      advance(20_000);
      expect(result.current.status).toBe('recording');

      act(() => result.current.stop());
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });

    it('stays tap-to-stop where the browser has no Web Audio', async () => {
      const { result } = renderWith(null);
      await act(() => result.current.start());

      advance(60_000);
      expect(result.current.status).toBe('recording');

      act(() => result.current.stop());
      expect(onRecorded).toHaveBeenCalledTimes(1);
      expect(result.current.lastEnd).toBe('manual');
    });
  });
});

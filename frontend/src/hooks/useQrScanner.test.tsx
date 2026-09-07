import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQrScanner } from './useQrScanner';

const decodeFrame = vi.fn();

// The decoder needs a real canvas, which jsdom does not provide. Camera
// lifecycle is what these tests are about, so the pixels are stubbed.
vi.mock('@/lib/qrDecoder', () => ({
  createFrameDecoder: () => decodeFrame,
}));

function fakeStream() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}

function setGetUserMedia(impl: (() => Promise<MediaStream>) | undefined) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: impl ? { getUserMedia: vi.fn(impl) } : undefined,
  });
}

function domError(name: string): DOMException {
  return new DOMException('denied by test', name);
}

describe('useQrScanner', () => {
  beforeEach(() => {
    decodeFrame.mockReset().mockReturnValue(null);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the camera and reports that it is scanning', async () => {
    const { stream } = fakeStream();
    setGetUserMedia(() => Promise.resolve(stream));

    const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

    await waitFor(() => expect(result.current.status).toBe('scanning'));
  });

  it('asks for the rear camera', async () => {
    const { stream } = fakeStream();
    setGetUserMedia(() => Promise.resolve(stream));

    renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    const constraints = vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls[0][0];
    // The counter is behind the phone, not in front of it.
    expect(constraints).toMatchObject({ video: { facingMode: { ideal: 'environment' } } });
  });

  describe('when the camera cannot be used', () => {
    it('reports a refused permission and offers a way forward', async () => {
      setGetUserMedia(() => Promise.reject(domError('NotAllowedError')));

      const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

      await waitFor(() => expect(result.current.status).toBe('denied'));
      expect(result.current.message).toMatch(/blocked/i);
      // Never a dead end: the printed code is always an alternative.
      expect(result.current.message).toMatch(/enter the code/i);
    });

    it('reports a device with no camera', async () => {
      setGetUserMedia(() => Promise.reject(domError('NotFoundError')));

      const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.message).toMatch(/no camera/i);
    });

    it('reports a camera another app is holding', async () => {
      setGetUserMedia(() => Promise.reject(domError('NotReadableError')));

      const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.message).toMatch(/another app/i);
    });

    it('treats an unrecognised failure as retryable rather than fatal', async () => {
      setGetUserMedia(() => Promise.reject(new Error('something odd')));

      const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

      await waitFor(() => expect(result.current.status).toBe('error'));
    });

    it('explains when the browser exposes no camera API at all', async () => {
      setGetUserMedia(undefined);

      const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.message).toMatch(/cannot use the camera/i);
    });

    it('explains an insecure connection instead of failing vaguely', async () => {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.message).toMatch(/secure/i);
    });

    it('retries after a refusal', async () => {
      setGetUserMedia(() => Promise.reject(domError('NotAllowedError')));

      const { result } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));
      await waitFor(() => expect(result.current.status).toBe('denied'));

      const { stream } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));

      act(() => result.current.retry());

      await waitFor(() => expect(result.current.status).toBe('scanning'));
    });
  });

  describe('releasing the camera', () => {
    it('stops every track when the page unmounts', async () => {
      const { stream, stop } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));

      const { result, unmount } = renderHook(() =>
        useQrScanner({ onDecode: vi.fn(), enabled: true }),
      );
      await waitFor(() => expect(result.current.status).toBe('scanning'));

      unmount();

      // The camera indicator stays lit until the tracks are stopped.
      expect(stop).toHaveBeenCalled();
    });

    it('stops the camera when scanning is disabled', async () => {
      const { stream, stop } = fakeStream();
      setGetUserMedia(() => Promise.resolve(stream));

      const { result, rerender } = renderHook(
        ({ enabled }) => useQrScanner({ onDecode: vi.fn(), enabled }),
        { initialProps: { enabled: true } },
      );
      await waitFor(() => expect(result.current.status).toBe('scanning'));

      rerender({ enabled: false });

      expect(stop).toHaveBeenCalled();
      await waitFor(() => expect(result.current.status).toBe('idle'));
    });

    it('does not open the camera at all while disabled', async () => {
      setGetUserMedia(() => Promise.resolve(fakeStream().stream));

      renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: false }));

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    });

    it('releases a stream that arrives after the page has gone', async () => {
      const { stream, stop } = fakeStream();
      let grant!: (value: MediaStream) => void;
      setGetUserMedia(() => new Promise<MediaStream>((resolve) => (grant = resolve)));

      const { unmount } = renderHook(() => useQrScanner({ onDecode: vi.fn(), enabled: true }));

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

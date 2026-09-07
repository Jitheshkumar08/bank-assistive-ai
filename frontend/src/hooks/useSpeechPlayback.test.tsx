import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechPlayback } from './useSpeechPlayback';

/**
 * jsdom has no media stack: object URLs do not exist and play() is not
 * implemented. Both are stubbed so the lifecycle this hook is actually
 * responsible for -- one clip at a time, and every URL revoked -- can be
 * observed without an audio device.
 */
let created: string[] = [];
let revoked: string[] = [];
let counter = 0;

/** The audio elements the hook constructed, in order. */
let elements: HTMLAudioElement[] = [];
let playBehaviour: 'resolve' | 'reject' = 'resolve';

beforeEach(() => {
  created = [];
  revoked = [];
  elements = [];
  counter = 0;
  playBehaviour = 'resolve';

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:fake/${++counter}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });

  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLAudioElement,
  ) {
    elements.push(this);
    return playBehaviour === 'resolve'
      ? Promise.resolve()
      : Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
  });

  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const audio = (size = 1024) => new Blob([new Uint8Array(size)], { type: 'audio/mpeg' });

describe('useSpeechPlayback', () => {
  it('starts silent', () => {
    const { result } = renderHook(() => useSpeechPlayback());

    expect(result.current.isSpeaking).toBe(false);
  });

  it('plays a reply and reports speaking', async () => {
    const { result } = renderHook(() => useSpeechPlayback());

    act(() => void result.current.play(audio()));

    await waitFor(() => expect(result.current.isSpeaking).toBe(true));
    expect(created).toHaveLength(1);
  });

  it('returns to silence and releases the audio when playback ends', async () => {
    const { result } = renderHook(() => useSpeechPlayback());

    let finished!: Promise<void>;
    act(() => {
      finished = result.current.play(audio());
    });
    await waitFor(() => expect(result.current.isSpeaking).toBe(true));

    // The browser signals the end of the clip.
    await act(async () => {
      elements[0].onended?.(new Event('ended'));
      await finished;
    });

    expect(result.current.isSpeaking).toBe(false);
    // A URL that is never revoked keeps the audio alive for the life of
    // the page.
    expect(revoked).toEqual(created);
  });

  it('treats an empty recording as nothing to play', async () => {
    const { result } = renderHook(() => useSpeechPlayback());

    await act(() => result.current.play(new Blob([], { type: 'audio/mpeg' })));

    expect(result.current.isSpeaking).toBe(false);
    expect(created).toHaveLength(0);
  });

  describe('interruption', () => {
    it('stops playback and releases the audio', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => void result.current.play(audio()));
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      act(() => result.current.stop());

      expect(result.current.isSpeaking).toBe(false);
      expect(revoked).toEqual(created);
    });

    it('never lets two replies talk over each other', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => void result.current.play(audio()));
      await waitFor(() => expect(created).toHaveLength(1));

      // A second reply arrives while the first is still speaking.
      act(() => void result.current.play(audio()));
      await waitFor(() => expect(created).toHaveLength(2));

      // The first was released before the second began.
      expect(revoked).toContain(created[0]);
      expect(revoked).not.toContain(created[1]);
      expect(result.current.isSpeaking).toBe(true);
    });

    it('ignores a stopped clip finishing afterwards', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      let finished!: Promise<void>;
      act(() => {
        finished = result.current.play(audio());
      });
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      // Captured before stopping: release() detaches the handler, so a
      // late browser callback has to be held onto to be simulated.
      const lateHandler = elements[0].onended;
      act(() => result.current.stop());

      act(() => void result.current.play(audio()));
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      // The abandoned clip reports completion late; it must not silence
      // the one now playing.
      await act(async () => {
        lateHandler?.call(elements[0], new Event('ended'));
        await finished;
      });

      expect(result.current.isSpeaking).toBe(true);
    });
  });

  describe('failure', () => {
    it('returns to a safe state when playback cannot start', async () => {
      playBehaviour = 'reject';

      const { result } = renderHook(() => useSpeechPlayback());

      // Autoplay refusal is the common case on iOS. The written reply is
      // already on screen, so this must not become an error.
      await act(() => result.current.play(audio()));

      await waitFor(() => expect(result.current.isSpeaking).toBe(false));
      expect(revoked).toEqual(created);
    });

    it('returns to a safe state when the audio cannot be decoded', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      let finished!: Promise<void>;
      act(() => {
        finished = result.current.play(audio());
      });
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      await act(async () => {
        elements[0].onerror?.(new Event('error'));
        await finished;
      });

      expect(result.current.isSpeaking).toBe(false);
      expect(revoked).toEqual(created);
    });
  });

  describe('permission to make sound', () => {
    it('reuses one audio element for every clip', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => void result.current.play(audio()));
      await waitFor(() => expect(elements).toHaveLength(1));

      act(() => result.current.stop());

      act(() => void result.current.play(audio()));
      await waitFor(() => expect(elements).toHaveLength(2));

      // The whole point. Browsers grant playback permission to an
      // element, not to the page, so a fresh element per clip throws
      // away whatever a user gesture just bought.
      expect(elements[0]).toBe(elements[1]);
    });

    it('primes the element with silence when a gesture allows it', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => result.current.unlock());

      await waitFor(() => expect(elements).toHaveLength(1));
      // Silent and instantaneous: the customer hears nothing, and the
      // element is now allowed to play sound later.
      expect(elements[0].src).toMatch(/^data:audio\/wav/);
    });

    it('unlocks the element that later clips actually use', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => result.current.unlock());
      await waitFor(() => expect(elements).toHaveLength(1));
      const unlocked = elements[0];

      act(() => void result.current.play(audio()));
      await waitFor(() => expect(elements).toHaveLength(2));

      expect(elements[1]).toBe(unlocked);
    });

    it('does not look like speech', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => result.current.unlock());
      await waitFor(() => expect(elements).toHaveLength(1));

      // Nothing is audible, so nothing should say the assistant is
      // talking -- and no reply blob was ever involved.
      expect(result.current.isSpeaking).toBe(false);
      expect(created).toHaveLength(0);
    });

    it('only ever primes once', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => {
        result.current.unlock();
        result.current.unlock();
        result.current.unlock();
      });

      await waitFor(() => expect(elements).toHaveLength(1));
    });

    it('never interrupts a reply that is already speaking', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      act(() => void result.current.play(audio()));
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      // A tap arrives mid-sentence. Priming now would cut the reply off
      // to prove a permission the browser has plainly already granted.
      act(() => result.current.unlock());

      expect(elements).toHaveLength(1);
      expect(result.current.isSpeaking).toBe(true);
      expect(revoked).not.toContain(created[0]);
    });

    it('survives a browser that refuses even the silent source', () => {
      playBehaviour = 'reject';

      const { result } = renderHook(() => useSpeechPlayback());

      // A refusal here is information, not an error: nothing was
      // audible and nothing is broken.
      expect(() => act(() => result.current.unlock())).not.toThrow();
      expect(result.current.isSpeaking).toBe(false);
    });
  });

  it('releases audio when the page goes away', async () => {
    const { result, unmount } = renderHook(() => useSpeechPlayback());

    act(() => void result.current.play(audio()));
    await waitFor(() => expect(created).toHaveLength(1));

    unmount();

    // Audio must never outlive the page that started it.
    expect(revoked).toEqual(created);
  });
});

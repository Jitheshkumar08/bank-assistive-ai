import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechPlayback, type PlaybackOutcome } from './useSpeechPlayback';

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
let playBehaviour: 'resolve' | 'reject' | 'deferred' = 'resolve';
/** Resolvers for play() calls made while playBehaviour is 'deferred'. */
let pendingPlays: Array<() => void> = [];

beforeEach(() => {
  created = [];
  revoked = [];
  elements = [];
  counter = 0;
  playBehaviour = 'resolve';
  pendingPlays = [];

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
    if (playBehaviour === 'deferred') {
      return new Promise<void>((resolve) => pendingPlays.push(resolve));
    }
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

    let finished!: Promise<PlaybackOutcome>;
    act(() => {
      finished = result.current.play(audio());
    });
    await waitFor(() => expect(result.current.isSpeaking).toBe(true));

    // The browser signals the end of the clip.
    await act(async () => {
      elements[0].onended?.(new Event('ended'));
      await finished;
    });

    await expect(finished).resolves.toBe('ended');
    expect(result.current.isSpeaking).toBe(false);
    // A URL that is never revoked keeps the audio alive for the life of
    // the page.
    expect(revoked).toEqual(created);
  });

  it('treats an empty recording as nothing to play -- not as heard', async () => {
    const { result } = renderHook(() => useSpeechPlayback());

    let outcome!: PlaybackOutcome;
    await act(async () => {
      outcome = await result.current.play(new Blob([], { type: 'audio/mpeg' }));
    });

    expect(outcome).toBe('failed');
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

      let finished!: Promise<PlaybackOutcome>;
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
      // Stopped is what it was; a late "ended" cannot rewrite that.
      await expect(finished).resolves.toBe('stopped');
    });

    it('settles a stopped clip as stopped, without any late browser event', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      let finished!: Promise<PlaybackOutcome>;
      act(() => {
        finished = result.current.play(audio());
      });
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      act(() => result.current.stop());

      // Before this contract, release() detached the handlers and this
      // promise never settled at all.
      await expect(finished).resolves.toBe('stopped');
    });

    it('settles a replaced clip as stopped, and the new one independently', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      let first!: Promise<PlaybackOutcome>;
      let second!: Promise<PlaybackOutcome>;
      act(() => {
        first = result.current.play(audio());
      });
      await waitFor(() => expect(elements).toHaveLength(1));
      act(() => {
        second = result.current.play(audio());
      });

      await expect(first).resolves.toBe('stopped');

      await act(async () => {
        elements[1].onended?.(new Event('ended'));
        await second;
      });
      await expect(second).resolves.toBe('ended');
    });

    it('settles once, however many events the browser fires', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      let finished!: Promise<PlaybackOutcome>;
      const settled = vi.fn();
      act(() => {
        finished = result.current.play(audio());
        void finished.then(settled);
      });
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      const { onended, onerror } = elements[0];
      await act(async () => {
        onended?.call(elements[0], new Event('ended'));
        onerror?.call(elements[0], new Event('error'));
        onended?.call(elements[0], new Event('ended'));
        await finished;
      });

      await expect(finished).resolves.toBe('ended');
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it('settles a pending clip as stopped when the component goes away', async () => {
      const { result, unmount } = renderHook(() => useSpeechPlayback());

      let finished!: Promise<PlaybackOutcome>;
      act(() => {
        finished = result.current.play(audio());
      });
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      unmount();

      await expect(finished).resolves.toBe('stopped');
    });
  });

  describe('failure', () => {
    it('returns to a safe state when playback cannot start', async () => {
      playBehaviour = 'reject';

      const { result } = renderHook(() => useSpeechPlayback());

      // Autoplay refusal is the common case on iOS. The written reply is
      // already on screen, so this must not throw -- but it was not heard,
      // so it must not report success either.
      let outcome!: PlaybackOutcome;
      await act(async () => {
        outcome = await result.current.play(audio());
      });

      expect(outcome).toBe('failed');
      await waitFor(() => expect(result.current.isSpeaking).toBe(false));
      expect(revoked).toEqual(created);
    });

    it('returns to a safe state when the audio cannot be decoded', async () => {
      const { result } = renderHook(() => useSpeechPlayback());

      let finished!: Promise<PlaybackOutcome>;
      act(() => {
        finished = result.current.play(audio());
      });
      await waitFor(() => expect(result.current.isSpeaking).toBe(true));

      await act(async () => {
        elements[0].onerror?.(new Event('error'));
        await finished;
      });

      await expect(finished).resolves.toBe('failed');
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

    it('never cuts off a reply that started before the silence was confirmed', async () => {
      playBehaviour = 'deferred';

      const { result } = renderHook(() => useSpeechPlayback());

      // A tap primes the element, and a reply claims it before the
      // browser has confirmed the silent clip started.
      act(() => result.current.unlock());
      act(() => void result.current.play(audio()));
      await waitFor(() => expect(elements).toHaveLength(2));

      const pause = vi.mocked(HTMLMediaElement.prototype.pause);
      const pausesBefore = pause.mock.calls.length;

      // The confirmation finally arrives. It belongs to the silence, which
      // is gone; pausing now would stop the reply mid-word.
      await act(async () => {
        pendingPlays[0]();
      });

      expect(pause.mock.calls.length).toBe(pausesBefore);
      expect(result.current.isSpeaking).toBe(true);
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

/**
 * Output routing over a mocked setSinkId: the element's own sinkId is what
 * is checked, as in the browser. No real device is involved.
 */
describe('useSpeechPlayback output routing', () => {
  /** What each element's mocked setSinkId actually does. */
  let sinkBehaviour: 'switch' | 'ignore' | 'reject';

  beforeEach(() => {
    sinkBehaviour = 'switch';
    Object.defineProperty(window.HTMLMediaElement.prototype, 'sinkId', {
      get(this: HTMLMediaElement & { _sink?: string }) {
        return this._sink ?? '';
      },
      configurable: true,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'setSinkId', {
      value: vi.fn(async function (this: HTMLMediaElement & { _sink?: string }, id: string) {
        if (sinkBehaviour === 'reject') throw new DOMException('gone', 'NotFoundError');
        if (sinkBehaviour === 'switch') this._sink = id;
      }),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete (window.HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    delete (window.HTMLMediaElement.prototype as { sinkId?: unknown }).sinkId;
  });

  it('switches the element and confirms it from the element’s own sinkId', async () => {
    const { result } = renderHook(() => useSpeechPlayback());

    await act(() => result.current.setOutputDevice('spk-1'));

    act(() => void result.current.play(audio()));
    await waitFor(() => expect(elements).toHaveLength(1));
    expect(elements[0].sinkId).toBe('spk-1');
  });

  it('rejects when the browser resolves but does not actually switch', async () => {
    sinkBehaviour = 'ignore';
    const { result } = renderHook(() => useSpeechPlayback());

    await expect(result.current.setOutputDevice('spk-1')).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
  });

  it('rejects with the browser’s error for a missing device', async () => {
    sinkBehaviour = 'reject';
    const { result } = renderHook(() => useSpeechPlayback());

    await expect(result.current.setOutputDevice('bt-1')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('rejects as unsupported where outputs cannot be chosen', async () => {
    delete (window.HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    const { result } = renderHook(() => useSpeechPlayback());

    await expect(result.current.setOutputDevice('bt-1')).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('fails a clip, unplayed, when a routed player cannot reach its device', async () => {
    const { result } = renderHook(() => useSpeechPlayback());
    await act(() => result.current.setOutputDevice('bt-1'));

    // The element no longer reports the chosen device (as after a remount),
    // and switching back fails: the device is gone.
    Object.defineProperty(window.HTMLMediaElement.prototype, 'sinkId', {
      get: () => 'something-else',
      configurable: true,
    });
    sinkBehaviour = 'reject';

    let outcome!: PlaybackOutcome;
    await act(async () => {
      outcome = await result.current.play(audio());
    });

    expect(outcome).toBe('failed');
    expect(elements).toHaveLength(0);
  });

  it('leaves an unrouted player exactly as before', async () => {
    const setSinkId = window.HTMLMediaElement.prototype.setSinkId;
    const { result } = renderHook(() => useSpeechPlayback());

    act(() => void result.current.play(audio()));

    await waitFor(() => expect(elements).toHaveLength(1));
    expect(setSinkId).not.toHaveBeenCalled();
  });

  it('sets the element’s own volume, clamped, including on an element made later', async () => {
    const { result } = renderHook(() => useSpeechPlayback());

    act(() => result.current.setVolume(0.6));
    act(() => void result.current.play(audio()));
    await waitFor(() => expect(elements).toHaveLength(1));
    expect(elements[0].volume).toBeCloseTo(0.6);

    act(() => result.current.setVolume(5));
    expect(elements[0].volume).toBe(1);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechPlayback } from '@/hooks/useSpeechPlayback';
import type { PlayerSlot } from '@/lib/interpreterAudioOutput';
import { DEFAULT_STAFF_VOLUME, useInterpreterAudioRouting } from './useInterpreterAudioRouting';

/**
 * Device choice and its verification, over mocked browser APIs: a fake
 * navigator.mediaDevices and fake players whose setOutputDevice stands in
 * for setSinkId. This proves the bookkeeping -- never that sound reached a
 * particular physical device.
 */

const SPEAKER = { deviceId: 'spk-1', kind: 'audiooutput', label: 'Speakers (Realtek(R) Audio)', groupId: 'g1' };
const HEADPHONES = { deviceId: 'bt-1', kind: 'audiooutput', label: 'Headphones (WH-1000XM4 Stereo)', groupId: 'g2' };
const DEFAULT_ALIAS = { deviceId: 'default', kind: 'audiooutput', label: 'Default - Headphones (WH-1000XM4 Stereo)', groupId: 'g2' };
const MIC = { deviceId: 'mic-1', kind: 'audioinput', label: 'Microphone Array', groupId: 'g1' };

type FakeDevice = typeof SPEAKER;

let listed: FakeDevice[];
let changeListeners: Array<() => void>;
let mediaDevices: {
  enumerateDevices: ReturnType<typeof vi.fn>;
  getUserMedia: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  selectAudioOutput?: ReturnType<typeof vi.fn>;
};
const originalSetSinkId = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'setSinkId');

function fakePlayer(): SpeechPlayback {
  return {
    isSpeaking: false,
    play: vi.fn(async () => 'ended' as const),
    stop: vi.fn(),
    unlock: vi.fn(),
    setOutputDevice: vi.fn(async () => {}),
    setVolume: vi.fn(),
  };
}

let players: Record<PlayerSlot, SpeechPlayback>;

function supportSinkSelection(supported: boolean): void {
  if (supported) {
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      value: vi.fn(async () => {}),
      configurable: true,
      writable: true,
    });
  } else {
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  }
}

function disconnect(device: FakeDevice): void {
  listed = listed.filter((d) => d.deviceId !== device.deviceId);
  act(() => changeListeners.forEach((listener) => listener()));
}

function connect(device: FakeDevice): void {
  listed = [...listed, device];
  act(() => changeListeners.forEach((listener) => listener()));
}

async function renderRouting() {
  const hook = renderHook(() => useInterpreterAudioRouting(players));
  await waitFor(() => expect(mediaDevices.enumerateDevices).toHaveBeenCalled());
  return hook;
}

beforeEach(() => {
  window.localStorage.clear();
  listed = [DEFAULT_ALIAS, SPEAKER, HEADPHONES, MIC];
  changeListeners = [];
  mediaDevices = {
    enumerateDevices: vi.fn(async () => listed),
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
    addEventListener: (_type, listener) => changeListeners.push(listener),
    removeEventListener: (_type, listener) => {
      changeListeners = changeListeners.filter((l) => l !== listener);
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
  supportSinkSelection(true);
  players = { system_speaker: fakePlayer(), bluetooth_headphones: fakePlayer(), shared: fakePlayer() };
});

afterEach(() => {
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  if (originalSetSinkId) Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', originalSetSinkId);
  else supportSinkSelection(false);
});

describe('useInterpreterAudioRouting', () => {
  it('lists real outputs only: never the OS-default alias, never inputs', async () => {
    const { result } = await renderRouting();

    await waitFor(() => expect(result.current.devices).toHaveLength(2));
    expect(result.current.devices.map((d) => d.deviceId)).toEqual(['spk-1', 'bt-1']);
  });

  it('starts with nothing ready, so nothing is played', async () => {
    const { result } = await renderRouting();

    expect(result.current.routes.system_speaker.status).toBe('unselected');
    expect(result.current.readiness('system_speaker')).toBe('unrouted');
    expect(result.current.readiness('bluetooth_headphones')).toBe('unrouted');
    expect(result.current.independent).toBe(false);
  });

  it('routes the speaker and the headphones to their own chosen devices', async () => {
    const { result } = await renderRouting();

    act(() => result.current.choose('system_speaker', 'spk-1'));
    act(() => result.current.choose('bluetooth_headphones', 'bt-1'));

    await waitFor(() => expect(result.current.independent).toBe(true));
    expect(players.system_speaker.setOutputDevice).toHaveBeenCalledWith('spk-1');
    expect(players.bluetooth_headphones.setOutputDevice).toHaveBeenCalledWith('bt-1');
    expect(players.shared.setOutputDevice).not.toHaveBeenCalled();
    expect(result.current.readiness('system_speaker')).toBe('ready');
    expect(result.current.readiness('bluetooth_headphones')).toBe('ready');
  });

  it('is not ready while the switch is still being confirmed', async () => {
    let confirm!: () => void;
    vi.mocked(players.system_speaker.setOutputDevice).mockImplementation(
      () => new Promise<void>((resolve) => (confirm = resolve)),
    );
    const { result } = await renderRouting();

    act(() => result.current.choose('system_speaker', 'spk-1'));

    expect(result.current.routes.system_speaker.status).toBe('applying');
    expect(result.current.readiness('system_speaker')).toBe('unrouted');

    await act(async () => confirm());
    expect(result.current.routes.system_speaker.status).toBe('ready');
  });

  it('reports a device the browser refused as denied, and does not play there', async () => {
    vi.mocked(players.bluetooth_headphones.setOutputDevice).mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );
    const { result } = await renderRouting();

    act(() => result.current.choose('bluetooth_headphones', 'bt-1'));

    await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('denied'));
    expect(result.current.readiness('bluetooth_headphones')).toBe('unrouted');
  });

  it('reports a failed verification as an error', async () => {
    vi.mocked(players.system_speaker.setOutputDevice).mockRejectedValue(
      new DOMException('did not switch', 'InvalidStateError'),
    );
    const { result } = await renderRouting();

    act(() => result.current.choose('system_speaker', 'spk-1'));

    await waitFor(() => expect(result.current.routes.system_speaker.status).toBe('error'));
  });

  it('treats one device chosen for both people as not independent', async () => {
    const { result } = await renderRouting();

    act(() => result.current.choose('system_speaker', 'spk-1'));
    act(() => result.current.choose('bluetooth_headphones', 'spk-1'));

    await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('ready'));
    expect(result.current.sameDevice).toBe(true);
    expect(result.current.independent).toBe(false);
    expect(result.current.readiness('system_speaker')).toBe('unrouted');
    expect(result.current.readiness('bluetooth_headphones')).toBe('unrouted');

    // Only an explicit choice makes it playable.
    act(() => result.current.setSharedFallback(true));
    expect(result.current.readiness('bluetooth_headphones')).toBe('ready');
  });

  describe('disconnection', () => {
    async function routedBoth() {
      const hook = await renderRouting();
      act(() => hook.result.current.choose('system_speaker', 'spk-1'));
      act(() => hook.result.current.choose('bluetooth_headphones', 'bt-1'));
      await waitFor(() => expect(hook.result.current.independent).toBe(true));
      return hook;
    }

    it('stops the headphones player and stops being ready when they disconnect', async () => {
      const { result } = await routedBoth();

      disconnect(HEADPHONES);

      await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('missing'));
      expect(players.bluetooth_headphones.stop).toHaveBeenCalled();
      expect(result.current.readiness('bluetooth_headphones')).toBe('unrouted');
      // The other listener is unaffected.
      expect(result.current.readiness('system_speaker')).toBe('ready');
    });

    it('plays a missing destination on the default output only with the fallback on', async () => {
      const { result } = await routedBoth();
      disconnect(HEADPHONES);
      await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('missing'));

      act(() => result.current.setSharedFallback(true));

      expect(result.current.readiness('bluetooth_headphones')).toBe('shared');
      expect(result.current.readiness('system_speaker')).toBe('ready');
    });

    it('switches back when the headphones reconnect', async () => {
      const { result } = await routedBoth();
      disconnect(HEADPHONES);
      await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('missing'));

      connect(HEADPHONES);

      await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('ready'));
      expect(players.bluetooth_headphones.setOutputDevice).toHaveBeenCalledTimes(2);
    });

    it('stops listening for device changes when it goes away', async () => {
      const { unmount } = await renderRouting();
      expect(changeListeners).toHaveLength(1);

      unmount();

      expect(changeListeners).toHaveLength(0);
    });
  });

  describe('unsupported browsers', () => {
    it('says so, and plays nothing until the fallback is accepted', async () => {
      supportSinkSelection(false);
      const { result } = renderHook(() => useInterpreterAudioRouting(players));

      expect(result.current.supported).toBe(false);
      expect(result.current.routes.system_speaker.status).toBe('unsupported');
      expect(result.current.readiness('system_speaker')).toBe('unrouted');

      act(() => result.current.choose('system_speaker', 'spk-1'));
      expect(players.system_speaker.setOutputDevice).not.toHaveBeenCalled();

      act(() => result.current.setSharedFallback(true));
      expect(result.current.readiness('system_speaker')).toBe('shared');
      expect(result.current.readiness('bluetooth_headphones')).toBe('shared');
    });

    it('copes with no mediaDevices at all', () => {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      const { result } = renderHook(() => useInterpreterAudioRouting(players));

      expect(result.current.supported).toBe(false);
    });
  });

  describe('access to device names', () => {
    beforeEach(() => {
      // How Chrome lists outputs before the page may use the microphone.
      listed = [{ deviceId: '', kind: 'audiooutput', label: '', groupId: '' }];
    });

    it('asks for access when the browser withholds devices', async () => {
      const { result } = await renderRouting();

      await waitFor(() => expect(result.current.needsAccess).toBe(true));
      expect(result.current.devices).toEqual([]);
    });

    it('lists devices once access is granted', async () => {
      const { result } = await renderRouting();
      mediaDevices.getUserMedia.mockImplementation(async () => {
        listed = [DEFAULT_ALIAS, SPEAKER, HEADPHONES];
        return { getTracks: () => [{ stop: vi.fn() }] };
      });

      await act(() => result.current.requestAccess());

      expect(result.current.needsAccess).toBe(false);
      expect(result.current.devices).toHaveLength(2);
    });

    it('explains a refused permission', async () => {
      mediaDevices.getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
      const { result } = await renderRouting();

      await act(() => result.current.requestAccess());

      expect(result.current.accessDenied).toBe(true);
    });
  });

  describe('the browser’s own picker', () => {
    it('chooses the device picked', async () => {
      mediaDevices.selectAudioOutput = vi.fn(async () => HEADPHONES);
      const { result } = await renderRouting();
      expect(result.current.canPrompt).toBe(true);

      await act(() => result.current.promptFor('bluetooth_headphones'));

      await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('ready'));
      expect(players.bluetooth_headphones.setOutputDevice).toHaveBeenCalledWith('bt-1');
    });

    it('marks a refused picker as denied', async () => {
      mediaDevices.selectAudioOutput = vi.fn(async () => {
        throw new DOMException('no', 'NotAllowedError');
      });
      const { result } = await renderRouting();

      await act(() => result.current.promptFor('bluetooth_headphones'));

      expect(result.current.routes.bluetooth_headphones.status).toBe('denied');
    });
  });

  describe('volume', () => {
    it('starts moderate, on the staff speaker and the shared player only', async () => {
      const { result } = await renderRouting();

      expect(result.current.volume).toBe(DEFAULT_STAFF_VOLUME);
      expect(players.system_speaker.setVolume).toHaveBeenCalledWith(DEFAULT_STAFF_VOLUME);
      expect(players.shared.setVolume).toHaveBeenCalledWith(DEFAULT_STAFF_VOLUME);
      expect(players.bluetooth_headphones.setVolume).not.toHaveBeenCalled();
    });

    it('applies a change, clamped to 0..1', async () => {
      const { result } = await renderRouting();

      act(() => result.current.setVolume(0.4));
      expect(players.system_speaker.setVolume).toHaveBeenLastCalledWith(0.4);

      act(() => result.current.setVolume(3));
      expect(result.current.volume).toBe(1);
    });
  });

  describe('remembered choices', () => {
    it('restores and re-verifies saved devices', async () => {
      const first = await renderRouting();
      act(() => first.result.current.choose('system_speaker', 'spk-1'));
      act(() => first.result.current.setVolume(0.5));
      await waitFor(() => expect(first.result.current.routes.system_speaker.status).toBe('ready'));
      first.unmount();

      players = { system_speaker: fakePlayer(), bluetooth_headphones: fakePlayer(), shared: fakePlayer() };
      const { result } = await renderRouting();

      await waitFor(() => expect(result.current.routes.system_speaker.status).toBe('ready'));
      expect(players.system_speaker.setOutputDevice).toHaveBeenCalledWith('spk-1');
      expect(result.current.volume).toBe(0.5);
    });

    it('shows a saved device that is no longer connected as missing', async () => {
      window.localStorage.setItem(
        'bank-ai.interpreter.audio-outputs',
        JSON.stringify({ bluetooth_headphones: 'bt-gone' }),
      );
      const { result } = await renderRouting();

      await waitFor(() => expect(result.current.routes.bluetooth_headphones.status).toBe('missing'));
      expect(result.current.readiness('bluetooth_headphones')).toBe('unrouted');
    });
  });
});

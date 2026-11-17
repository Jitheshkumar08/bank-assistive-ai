import { describe, expect, it, vi } from 'vitest';
import type { PlaybackOutcome, SpeechPlayback } from '@/hooks/useSpeechPlayback';
import {
  createWebAudioOutput,
  DESTINATION_FOR,
  type AudioDestination,
  type PlayerSlot,
  type RouteReadiness,
} from './interpreterAudioOutput';

/**
 * The web adapter decides WHICH player a translation goes to. Players are
 * fakes: this proves the choice, not that any physical speaker sounded.
 */

function fakePlayer(outcome: PlaybackOutcome = 'ended'): SpeechPlayback {
  return {
    isSpeaking: false,
    play: vi.fn(async () => outcome),
    stop: vi.fn(),
    unlock: vi.fn(),
    setOutputDevice: vi.fn(async () => {}),
    setVolume: vi.fn(),
  };
}

function setup(ready: Partial<Record<AudioDestination, RouteReadiness>> = {}) {
  const players: Record<PlayerSlot, SpeechPlayback> = {
    system_speaker: fakePlayer(),
    bluetooth_headphones: fakePlayer(),
    shared: fakePlayer(),
  };
  const routes: Record<AudioDestination, RouteReadiness> = {
    system_speaker: 'ready',
    bluetooth_headphones: 'ready',
    ...ready,
  };
  const output = createWebAudioOutput({ players, readiness: (d) => routes[d] });
  return { players, routes, output };
}

const clip = new Blob([new Uint8Array(8)], { type: 'audio/mpeg' });

describe('createWebAudioOutput', () => {
  it('maps each listener to their own destination', () => {
    expect(DESTINATION_FOR.staff).toBe('system_speaker');
    expect(DESTINATION_FOR.customer).toBe('bluetooth_headphones');
  });

  it('plays a translation for staff on the speaker player only', async () => {
    const { players, output } = setup();

    await expect(output.play(clip, 'staff')).resolves.toBe('ended');

    expect(players.system_speaker.play).toHaveBeenCalledWith(clip);
    expect(players.bluetooth_headphones.play).not.toHaveBeenCalled();
    expect(players.shared.play).not.toHaveBeenCalled();
  });

  it('plays a translation for the customer on the headphones player only', async () => {
    const { players, output } = setup();

    await output.play(clip, 'customer');

    expect(players.bluetooth_headphones.play).toHaveBeenCalledWith(clip);
    expect(players.system_speaker.play).not.toHaveBeenCalled();
  });

  it('stops every other player first, so two translations never overlap', async () => {
    const { players, output } = setup();

    await output.play(clip, 'customer');

    expect(players.system_speaker.stop).toHaveBeenCalled();
    expect(players.shared.stop).toHaveBeenCalled();
    expect(players.bluetooth_headphones.stop).not.toHaveBeenCalled();
  });

  it('does not play at all when the listener’s device is not ready', async () => {
    const { players, output } = setup({ bluetooth_headphones: 'unrouted' });

    await expect(output.play(clip, 'customer')).resolves.toBe('unrouted');

    for (const player of Object.values(players)) expect(player.play).not.toHaveBeenCalled();
  });

  it('uses the never-routed shared player only when the fallback was accepted', async () => {
    const { players, output } = setup({ bluetooth_headphones: 'shared' });

    await output.play(clip, 'customer');

    expect(players.shared.play).toHaveBeenCalledWith(clip);
    expect(players.bluetooth_headphones.play).not.toHaveBeenCalled();
  });

  it('reports a clip cut off by its device disappearing as unrouted, not finished', async () => {
    const { players, routes, output } = setup();
    vi.mocked(players.bluetooth_headphones.play).mockImplementation(async () => {
      routes.bluetooth_headphones = 'unrouted';
      return 'stopped';
    });

    await expect(output.play(clip, 'customer')).resolves.toBe('unrouted');
  });

  it('keeps an ordinary stop as stopped', async () => {
    const { players, output } = setup();
    vi.mocked(players.system_speaker.play).mockResolvedValue('stopped');

    await expect(output.play(clip, 'staff')).resolves.toBe('stopped');
  });

  it('passes a playback failure through', async () => {
    const { players, output } = setup();
    vi.mocked(players.system_speaker.play).mockResolvedValue('failed');

    await expect(output.play(clip, 'staff')).resolves.toBe('failed');
  });

  it('stops and unlocks every player', () => {
    const { players, output } = setup();

    output.stop();
    output.unlock();

    for (const player of Object.values(players)) {
      expect(player.stop).toHaveBeenCalled();
      expect(player.unlock).toHaveBeenCalled();
    }
  });
});

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechPlayback } from '@/hooks/useSpeechPlayback';
import {
  canChooseOutputs,
  canPromptForOutput,
  classifyOutputError,
  listAudioOutputs,
  onOutputsChanged,
  promptForOutput,
  requestDeviceAccess,
  type AudioOutputDevice,
} from '@/lib/audioOutputDevices';
import {
  DESTINATIONS,
  type AudioDestination,
  type PlayerSlot,
  type RouteReadiness,
} from '@/lib/interpreterAudioOutput';

/**
 * Where one destination stands.
 *
 *   unsupported  this browser cannot choose an output at all
 *   unselected   no device chosen yet
 *   applying     switching the element to the chosen device
 *   ready        the element reports the chosen device as its sink
 *   missing      the chosen device is not connected (or not listed)
 *   denied       the browser refused to use it
 *   error        switching failed for another reason
 */
export type RouteStatus = 'unsupported' | 'unselected' | 'applying' | 'ready' | 'missing' | 'denied' | 'error';

export interface DestinationRoute {
  deviceId: string | null;
  status: RouteStatus;
}

export interface AudioRouting {
  supported: boolean;
  /** The browser offers its own device picker (Firefox). */
  canPrompt: boolean;
  /** The browser is withholding devices or their names until access is granted. */
  needsAccess: boolean;
  accessDenied: boolean;
  devices: AudioOutputDevice[];
  routes: Record<AudioDestination, DestinationRoute>;
  /** Both destinations point at the same device: not independent routing. */
  sameDevice: boolean;
  /** Each listener has a verified device of their own. */
  independent: boolean;
  /** Staff accepted that a destination without a ready device plays on the default output. */
  sharedFallback: boolean;
  setSharedFallback: (on: boolean) => void;
  /** The staff-facing (and fallback) player's own volume, 0 to 1. */
  volume: number;
  setVolume: (volume: number) => void;
  /** Chooses a listed device, or clears the choice with ''. */
  choose: (destination: AudioDestination, deviceId: string) => void;
  /** Opens the browser's picker for a destination. Call from a tap. */
  promptFor: (destination: AudioDestination) => Promise<void>;
  /** Reveals device names (Chrome). Call from a tap. */
  requestAccess: () => Promise<void>;
  /** Read by the output adapter at the moment it plays. */
  readiness: (destination: AudioDestination) => RouteReadiness;
}

/** Moderate, so a translation does not blare across a banking hall. */
export const DEFAULT_STAFF_VOLUME = 0.7;

const STORAGE_KEY = 'bank-ai.interpreter.audio-outputs';

interface Saved {
  system_speaker?: string | null;
  bluetooth_headphones?: string | null;
  volume?: number;
}

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

function save(saved: Saved): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
}

/**
 * Chooses and keeps track of an output device for each interpreter
 * listener, and applies it to that listener's player.
 *
 * A destination is only ever 'ready' once its element has reported the
 * chosen device as its sink -- never because a device was merely picked.
 * Devices connecting and disconnecting are watched: a chosen device that
 * disappears stops its player at once and stops being ready, and one that
 * comes back is switched to again.
 *
 * Saved choices are browser device ids, which are per site and are reset
 * when site data is cleared; a saved id that no longer matches anything
 * shows as missing.
 */
export function useInterpreterAudioRouting(players: Record<PlayerSlot, SpeechPlayback>): AudioRouting {
  const [supported] = useState(canChooseOutputs);
  const [canPrompt] = useState(() => supported && canPromptForOutput());

  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const [routes, setRoutesState] = useState<Record<AudioDestination, DestinationRoute>>(() => {
    const saved = load();
    const initial = (deviceId: string | null | undefined): DestinationRoute => ({
      deviceId: supported ? (deviceId ?? null) : null,
      status: supported ? 'unselected' : 'unsupported',
    });
    return {
      system_speaker: initial(saved.system_speaker),
      bluetooth_headphones: initial(saved.bluetooth_headphones),
    };
  });
  const [sharedFallback, setSharedFallbackState] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    const saved = load().volume;
    return typeof saved === 'number' && saved >= 0 && saved <= 1 ? saved : DEFAULT_STAFF_VOLUME;
  });

  // Read synchronously by the adapter while it plays, and by async steps.
  const routesRef = useRef(routes);
  const sharedRef = useRef(sharedFallback);
  const playersRef = useRef(players);
  playersRef.current = players;
  /** Bumped per destination by every new attempt, so a slow one cannot overwrite a newer one. */
  const attemptRef = useRef<Record<AudioDestination, number>>({ system_speaker: 0, bluetooth_headphones: 0 });
  const mountedRef = useRef(true);

  const setRoute = useCallback((destination: AudioDestination, patch: Partial<DestinationRoute>): void => {
    routesRef.current = {
      ...routesRef.current,
      [destination]: { ...routesRef.current[destination], ...patch },
    };
    setRoutesState(routesRef.current);
  }, []);

  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const persist = useCallback((patch: Saved): void => {
    save({
      system_speaker: routesRef.current.system_speaker.deviceId,
      bluetooth_headphones: routesRef.current.bluetooth_headphones.deviceId,
      volume: volumeRef.current,
      ...patch,
    });
  }, []);

  const apply = useCallback(
    async (destination: AudioDestination, deviceId: string): Promise<void> => {
      const attempt = ++attemptRef.current[destination];
      setRoute(destination, { deviceId, status: 'applying' });

      try {
        await playersRef.current[destination].setOutputDevice(deviceId);
        if (!mountedRef.current || attempt !== attemptRef.current[destination]) return;
        setRoute(destination, { status: 'ready' });
      } catch (caught) {
        if (!mountedRef.current || attempt !== attemptRef.current[destination]) return;
        setRoute(destination, { status: classifyOutputError(caught) });
      }
    },
    [setRoute],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!supported) return;

    let list;
    try {
      list = await listAudioOutputs();
    } catch {
      return;
    }
    if (!mountedRef.current) return;

    setNeedsAccess(list.needsAccess);
    setDevices(list.devices);

    for (const destination of DESTINATIONS) {
      const { deviceId, status } = routesRef.current[destination];
      if (!deviceId) continue;

      const present = list.devices.some((device) => device.deviceId === deviceId);

      if (!present && status !== 'missing') {
        attemptRef.current[destination] += 1;
        setRoute(destination, { status: 'missing' });
        // Gone mid-sentence: the browser would carry on through some other
        // device, which is exactly what must not happen.
        playersRef.current[destination].stop();
      } else if (present && (status === 'missing' || status === 'unselected')) {
        void apply(destination, deviceId);
      }
    }
  }, [supported, apply, setRoute]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const unsubscribe = onOutputsChanged(() => void refresh());
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    playersRef.current.system_speaker.setVolume(volume);
    playersRef.current.shared.setVolume(volume);
  }, [volume]);

  const choose = useCallback(
    (destination: AudioDestination, deviceId: string): void => {
      if (!supported) return;

      if (!deviceId) {
        attemptRef.current[destination] += 1;
        playersRef.current[destination].stop();
        setRoute(destination, { deviceId: null, status: 'unselected' });
      } else {
        void apply(destination, deviceId);
      }
      persist({});
    },
    [supported, apply, setRoute, persist],
  );

  const promptFor = useCallback(
    async (destination: AudioDestination): Promise<void> => {
      if (!canPrompt) return;

      try {
        const device = await promptForOutput(routesRef.current[destination].deviceId ?? undefined);
        if (!mountedRef.current) return;
        setDevices((current) =>
          current.some((d) => d.deviceId === device.deviceId) ? current : [...current, device],
        );
        choose(destination, device.deviceId);
      } catch (caught) {
        if (!mountedRef.current) return;
        // Dismissing the picker leaves a working choice alone.
        if (routesRef.current[destination].status !== 'ready') {
          setRoute(destination, { status: classifyOutputError(caught) });
        }
      }
    },
    [canPrompt, choose, setRoute],
  );

  const requestAccess = useCallback(async (): Promise<void> => {
    try {
      await requestDeviceAccess();
      if (!mountedRef.current) return;
      setAccessDenied(false);
      await refresh();
    } catch {
      if (mountedRef.current) setAccessDenied(true);
    }
  }, [refresh]);

  const setSharedFallback = useCallback((on: boolean): void => {
    sharedRef.current = on;
    setSharedFallbackState(on);
  }, []);

  const setVolume = useCallback(
    (next: number): void => {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeState(clamped);
      persist({ volume: clamped });
    },
    [persist],
  );

  const readiness = useCallback((destination: AudioDestination): RouteReadiness => {
    const current = routesRef.current;
    const other = current[destination === 'system_speaker' ? 'bluetooth_headphones' : 'system_speaker'];
    const own = current[destination];
    const shared = own.deviceId !== null && own.deviceId === other.deviceId;

    // One device for both people is only acceptable once staff said so.
    if (own.status === 'ready' && (!shared || sharedRef.current)) return 'ready';
    return sharedRef.current ? 'shared' : 'unrouted';
  }, []);

  const sameDevice =
    routes.system_speaker.deviceId !== null &&
    routes.system_speaker.deviceId === routes.bluetooth_headphones.deviceId;

  return {
    supported,
    canPrompt,
    needsAccess,
    accessDenied,
    devices,
    routes,
    sameDevice,
    independent:
      !sameDevice && routes.system_speaker.status === 'ready' && routes.bluetooth_headphones.status === 'ready',
    sharedFallback,
    setSharedFallback,
    volume,
    setVolume,
    choose,
    promptFor,
    requestAccess,
    readiness,
  };
}

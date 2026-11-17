import { useId } from 'react';
import type { AudioRouting, DestinationRoute } from '@/hooks/useInterpreterAudioRouting';
import { cn } from '@/lib/cn';
import type { AudioOutputDevice } from '@/lib/audioOutputDevices';
import type { AudioDestination } from '@/lib/interpreterAudioOutput';

export interface AudioOutputSettingsProps {
  routing: AudioRouting;
  /** True while a turn is running: devices are not switched mid-turn. */
  busy: boolean;
}

const DESTINATION_LABEL: Record<AudioDestination, string> = {
  system_speaker: 'Staff hears — laptop speaker',
  bluetooth_headphones: 'Customer hears — headphones',
};

const DESTINATION_HINT: Record<AudioDestination, string> = {
  system_speaker: 'Choose the built-in speaker, not the headphones.',
  bluetooth_headphones: 'Choose the headphones’ “Headphones” or “Stereo” entry, not “Hands-Free”.',
};

const SECONDARY =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-ink-800 ring-1 ring-ink-200 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-45';

function routeMessage(route: DestinationRoute, device: AudioOutputDevice | undefined): string {
  const name = device?.label ?? 'The chosen device';
  switch (route.status) {
    case 'ready':
      return `Ready: playing through ${name}.`;
    case 'applying':
      return 'Switching to this device…';
    case 'unselected':
      return 'Not chosen yet.';
    case 'missing':
      return `${name} is not connected. Connect it, or choose another device.`;
    case 'denied':
      return 'The browser did not allow this device. Allow it in the site settings, or choose again.';
    case 'error':
      return 'This device could not be used. Choose it again, or choose another.';
    case 'unsupported':
      return 'This browser cannot choose a device.';
  }
}

/**
 * Chooses which device each interpreter listener hears.
 *
 * Nothing here claims more than the browser can do: a destination says
 * "Ready" only when its player is verified on the chosen device, and
 * playing both people through one output is an explicit, labelled choice.
 */
export function AudioOutputSettings({ routing, busy }: AudioOutputSettingsProps) {
  const volumeId = useId();
  const fallbackId = useId();
  const { supported, independent, sameDevice, sharedFallback } = routing;

  const summary = !supported
    ? 'This browser cannot send each person’s translation to a different device. Use Chrome or Edge on the laptop, or allow the shared output below.'
    : independent
      ? 'Staff and customer each hear translations on their own device.'
      : sameDevice
        ? 'Both people are set to the same device, so each would hear both translations. Choose different devices, or allow the shared output below.'
        : 'Choose a device for each person. Translations are not played aloud until their device is ready.';

  return (
    // Remounted when routing becomes complete or incomplete, so it opens
    // itself exactly when something needs attention.
    <details
      key={String(independent)}
      open={!independent}
      className="rounded-3xl bg-white px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
    >
      <summary className="cursor-pointer text-xs font-medium tracking-[0.1em] text-ink-500 uppercase">
        Audio outputs{independent ? ' · ready' : ' · needs attention'}
      </summary>

      <p role="status" aria-live="polite" data-testid="audio-routing-status" className="mt-2 text-sm text-ink-800">
        {summary}
        {sharedFallback && !independent && (
          <> Shared output is on: anything without its own device plays through the browser’s default output.</>
        )}
      </p>

      {supported && routing.needsAccess && (
        <div className="mt-3">
          <p className="text-sm text-ink-600">
            The browser shows device names only after you allow microphone access. Nothing is recorded.
          </p>
          <button type="button" onClick={() => void routing.requestAccess()} disabled={busy} className={cn(SECONDARY, 'mt-2')}>
            Show audio devices
          </button>
          {routing.accessDenied && (
            <p className="mt-1 text-sm text-danger-700">
              Access was not allowed. Allow the microphone in the browser’s site settings, then try again.
            </p>
          )}
        </div>
      )}

      {supported && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(['system_speaker', 'bluetooth_headphones'] as const).map((destination) => (
            <DestinationPicker
              key={destination}
              destination={destination}
              routing={routing}
              busy={busy}
            />
          ))}
        </div>
      )}

      <div className="mt-3">
        <label htmlFor={volumeId} className="text-sm font-medium text-ink-800">
          Staff speaker volume: {Math.round(routing.volume * 100)}%
        </label>
        <input
          id={volumeId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(routing.volume * 100)}
          aria-valuetext={`${Math.round(routing.volume * 100)}%`}
          onChange={(event) => routing.setVolume(Number(event.target.value) / 100)}
          className="mt-1 block w-full accent-brand-600"
        />
        <p className="text-xs text-ink-500">
          Changes this app’s volume only. The laptop’s own volume still applies.
        </p>
      </div>

      {(!independent || sharedFallback) && (
        <div className="mt-3 flex items-start gap-2">
          <input
            id={fallbackId}
            type="checkbox"
            checked={sharedFallback}
            onChange={(event) => routing.setSharedFallback(event.target.checked)}
            className="mt-1 size-4 accent-brand-600"
          />
          <label htmlFor={fallbackId} className="text-sm text-ink-800">
            Allow a shared output: play a translation through the browser’s default output when its
            own device is not ready. Both people may hear both translations.
          </label>
        </div>
      )}
    </details>
  );
}

function DestinationPicker({
  destination,
  routing,
  busy,
}: {
  destination: AudioDestination;
  routing: AudioRouting;
  busy: boolean;
}) {
  const selectId = useId();
  const route = routing.routes[destination];
  const device = routing.devices.find((d) => d.deviceId === route.deviceId);
  const problem = !['ready', 'applying', 'unselected'].includes(route.status);

  return (
    <div>
      <label htmlFor={selectId} className="text-sm font-medium text-ink-800">
        {DESTINATION_LABEL[destination]}
      </label>
      <select
        id={selectId}
        value={route.deviceId ?? ''}
        onChange={(event) => routing.choose(destination, event.target.value)}
        disabled={busy}
        className="mt-1 block min-h-11 w-full rounded-xl bg-white px-3 text-[0.9375rem] text-ink-900 ring-1 ring-ink-200 disabled:opacity-60"
      >
        <option value="">Choose a device…</option>
        {routing.devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
        {route.deviceId && !device && <option value={route.deviceId}>Chosen device (not connected)</option>}
      </select>

      {routing.canPrompt && (
        <button
          type="button"
          onClick={() => void routing.promptFor(destination)}
          disabled={busy}
          className={cn(SECONDARY, 'mt-2')}
        >
          Choose with the browser…
        </button>
      )}

      <p
        data-testid={`route-${destination}`}
        className={cn('mt-1 text-sm', problem ? 'text-danger-700' : 'text-ink-600')}
      >
        {routeMessage(route, device)}
      </p>
      <p className="text-xs text-ink-500">{DESTINATION_HINT[destination]}</p>
    </div>
  );
}

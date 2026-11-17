/**
 * The browser's audio-output APIs, feature-detected and wrapped.
 *
 * What a web page can and cannot do here:
 *
 *   setSinkId()           sends ONE media element's audio to one output
 *                         device. Chrome and Edge (desktop, 110+), Firefox
 *                         116+. Not Safari on iOS; check before relying on
 *                         desktop Safari. It never touches other apps or
 *                         the operating system's mixer.
 *   enumerateDevices()    lists outputs. Chrome hides their ids and names
 *                         until the page may use the microphone; Firefox
 *                         lists only outputs the person has chosen through
 *                         selectAudioOutput().
 *   selectAudioOutput()   the browser's own device picker, which also grants
 *                         permission for the device picked. Firefox only at
 *                         the time of writing; needs a tap.
 *
 * Chrome on Windows also lists "default" and "communications": aliases
 * that follow whichever device the OS currently prefers, which becomes the
 * Bluetooth headphones the moment they connect. That is exactly the bug
 * this exists to fix, so the aliases are never offered.
 */

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

export interface AudioOutputList {
  devices: AudioOutputDevice[];
  /** True when the browser is withholding devices or their names until access is granted. */
  needsAccess: boolean;
}

/** Why an output could not be used, in terms the UI can explain. */
export type OutputFailure = 'unsupported' | 'denied' | 'missing' | 'error';

type SelectAudioOutput = (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;

const ALIASES = new Set(['default', 'communications']);

function mediaDevices(): MediaDevices | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
}

/** Whether this browser can send one element's audio to a chosen device. */
export function canChooseOutputs(): boolean {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function' &&
    typeof mediaDevices()?.enumerateDevices === 'function'
  );
}

/** Whether the browser offers its own output picker. */
export function canPromptForOutput(): boolean {
  const devices = mediaDevices() as (MediaDevices & { selectAudioOutput?: SelectAudioOutput }) | undefined;
  return typeof devices?.selectAudioOutput === 'function';
}

/** The real, choosable output devices -- never the OS-default aliases. */
export async function listAudioOutputs(): Promise<AudioOutputList> {
  const all = await mediaDevices()!.enumerateDevices();
  const outputs = all.filter((device) => device.kind === 'audiooutput');
  const real = outputs.filter((device) => device.deviceId && !ALIASES.has(device.deviceId));

  return {
    devices: real.map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Audio output ${index + 1}`,
    })),
    needsAccess: real.length === 0 || outputs.some((device) => !device.deviceId || !device.label),
  };
}

/**
 * Asks for microphone permission only so that Chrome reveals output names,
 * then releases the microphone at once. Nothing is recorded.
 */
export async function requestDeviceAccess(): Promise<void> {
  const stream = await mediaDevices()!.getUserMedia({ audio: true, video: false });
  stream.getTracks().forEach((track) => track.stop());
}

/** Opens the browser's output picker. Must be called from a tap. */
export async function promptForOutput(current?: string): Promise<AudioOutputDevice> {
  const devices = mediaDevices() as MediaDevices & { selectAudioOutput: SelectAudioOutput };
  const chosen = await devices.selectAudioOutput(current ? { deviceId: current } : undefined);
  return { deviceId: chosen.deviceId, label: chosen.label || 'Chosen audio output' };
}

/** Subscribes to devices being connected or disconnected. */
export function onOutputsChanged(listener: () => void): () => void {
  const devices = mediaDevices();
  if (!devices?.addEventListener) return () => {};
  devices.addEventListener('devicechange', listener);
  return () => devices.removeEventListener('devicechange', listener);
}

export function classifyOutputError(error: unknown): OutputFailure {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotSupportedError':
      return 'unsupported';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
      return 'missing';
    default:
      return 'error';
  }
}

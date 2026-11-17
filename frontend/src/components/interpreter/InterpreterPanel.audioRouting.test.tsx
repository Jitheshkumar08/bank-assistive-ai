import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMicrophoneControls as mic } from '@/test/fakeMicrophone';
import type { InterpreterClient } from '@/types/interpreter';
import { InterpreterPanel } from './InterpreterPanel';

/**
 * Independent audio routing, end to end through the real panel, the real
 * players (useSpeechPlayback), the real routing hook and the real adapter.
 *
 * Mocked: the browser's audio APIs (enumerateDevices, devicechange,
 * setSinkId/sinkId, play), the microphone and the interpreter server.
 * What is proven is which element -- pointed at which device id -- each
 * translation was played on. Whether a laptop's speaker or a pair of
 * headphones then made the sound can only be checked by ear.
 */

vi.mock('@/hooks/useMicrophone', async () => ({
  useMicrophone: (await import('@/test/fakeMicrophone')).fakeUseMicrophone,
}));

const SPEAKER = { deviceId: 'spk-1', kind: 'audiooutput', label: 'Speakers (Realtek(R) Audio)', groupId: 'g1' };
const HEADPHONES = { deviceId: 'bt-1', kind: 'audiooutput', label: 'Headphones (WH-1000XM4 Stereo)', groupId: 'g2' };
const DEFAULT_ALIAS = { deviceId: 'default', kind: 'audiooutput', label: 'Default - Headphones (WH-1000XM4 Stereo)', groupId: 'g2' };

type Sinkable = HTMLMediaElement & { _sink?: string };

let listed: Array<typeof SPEAKER>;
let changeListeners: Array<() => void>;
/** Every real clip played: the element and the device id it was on at that moment. */
let played: Array<{ element: HTMLMediaElement; sink: string }>;

const client = {
  languages: vi.fn(async () => [
    { code: 'kn', name: 'Kannada', speech: true },
    { code: 'en', name: 'English', speech: true },
  ]),
  transcribe: vi.fn(async ({ language }: { language: string }) => ({
    text: language === 'kn' ? 'ನನಗೆ ಸಹಾಯ ಬೇಕು' : 'Please sign here',
    language,
  })),
  translate: vi.fn(async ({ targetLanguage }: { targetLanguage: string }) => ({
    translation: targetLanguage === 'en' ? 'I need help' : 'ದಯವಿಟ್ಟು ಇಲ್ಲಿ ಸಹಿ ಮಾಡಿ',
  })),
  speak: vi.fn(async () => new Blob([new Uint8Array(16)], { type: 'audio/mpeg' })),
} satisfies InterpreterClient;

beforeEach(() => {
  mic.reset();
  window.localStorage.clear();
  listed = [DEFAULT_ALIAS, SPEAKER, HEADPHONES];
  changeListeners = [];
  played = [];

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => listed),
      getUserMedia: vi.fn(),
      addEventListener: (_: string, listener: () => void) => changeListeners.push(listener),
      removeEventListener: (_: string, listener: () => void) => {
        changeListeners = changeListeners.filter((l) => l !== listener);
      },
    },
  });

  Object.defineProperty(HTMLMediaElement.prototype, 'sinkId', {
    configurable: true,
    get(this: Sinkable) {
      return this._sink ?? '';
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
    configurable: true,
    writable: true,
    value: vi.fn(async function (this: Sinkable, id: string) {
      if (id && !listed.some((d) => d.deviceId === id)) throw new DOMException('gone', 'NotFoundError');
      this._sink = id;
    }),
  });

  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: Sinkable) {
    // The silent unlock clip is not a translation.
    if (this.getAttribute('src')?.startsWith('blob:')) played.push({ element: this, sink: this._sink ?? '' });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  delete (HTMLMediaElement.prototype as { sinkId?: unknown }).sinkId;
});

function renderPanel() {
  return render(
    <InterpreterPanel sessionId="sess-1" customerLanguage="kn" savedTask={null} onReturn={() => {}} client={client} />,
  );
}

async function chooseDevices() {
  await screen.findAllByRole('option', { name: SPEAKER.label, hidden: true });
  await userEvent.selectOptions(screen.getByLabelText('Staff hears — laptop speaker'), 'spk-1');
  await userEvent.selectOptions(screen.getByLabelText('Customer hears — headphones'), 'bt-1');
  await waitFor(() =>
    expect(screen.getByTestId('audio-routing-status')).toHaveTextContent('each hear translations on their own device'),
  );
}

/** A full turn up to the translation starting to play. */
async function turn(button: 'My turn — Speak' | 'Staff turn — Speak') {
  await userEvent.click(await screen.findByRole('button', { name: button }));
  act(() => mic.endpoint!('speech_ended'));
}

async function finishPlaying() {
  const last = played.at(-1)!;
  await act(async () => last.element.onended?.(new Event('ended')));
}

describe('interpreter audio routing', () => {
  it('offers the real devices, never the OS-default alias', async () => {
    renderPanel();

    await screen.findAllByRole('option', { name: SPEAKER.label, hidden: true });
    expect(screen.queryByRole('option', { name: DEFAULT_ALIAS.label, hidden: true })).not.toBeInTheDocument();
  });

  it('plays the customer’s words, translated for staff, on the laptop speaker', async () => {
    renderPanel();
    await chooseDevices();

    await turn('My turn — Speak');

    await waitFor(() => expect(played).toHaveLength(1));
    expect(played[0].sink).toBe('spk-1');
    await finishPlaying();
    await screen.findByText(/Staff’s turn next/);
  });

  it('plays the staff’s words, translated for the customer, in the headphones', async () => {
    renderPanel();
    await chooseDevices();

    await turn('Staff turn — Speak');

    await waitFor(() => expect(played).toHaveLength(1));
    expect(played[0].sink).toBe('bt-1');
  });

  it('keeps alternating turns on their own devices', async () => {
    renderPanel();
    await chooseDevices();

    await turn('My turn — Speak');
    await waitFor(() => expect(played).toHaveLength(1));
    await finishPlaying();
    await turn('Staff turn — Speak');
    await waitFor(() => expect(played).toHaveLength(2));
    await finishPlaying();

    expect(played.map((p) => p.sink)).toEqual(['spk-1', 'bt-1']);
    expect(played[0].element).not.toBe(played[1].element);
  });

  it('plays nothing before devices are chosen, and says why', async () => {
    renderPanel();
    await screen.findAllByRole('option', { name: SPEAKER.label, hidden: true });

    await turn('My turn — Speak');

    await screen.findByText(/for the staff was not played because their audio output is not ready/);
    expect(played).toHaveLength(0);
    expect(screen.getByText('I need help')).toBeInTheDocument();
  });

  it('reports disconnected headphones, plays nothing elsewhere, and uses the default output only once allowed', async () => {
    renderPanel();
    await chooseDevices();

    listed = [DEFAULT_ALIAS, SPEAKER];
    act(() => changeListeners.forEach((listener) => listener()));
    await screen.findByText(/Headphones \(WH-1000XM4 Stereo\) is not connected|The chosen device is not connected/);

    await turn('Staff turn — Speak');
    await screen.findByText(/for the customer was not played/);
    expect(played).toHaveLength(0);

    // Staff explicitly accept the shared output, then play again.
    await userEvent.click(screen.getByLabelText(/Allow a shared output/));
    await userEvent.click(screen.getByRole('button', { name: 'Play the translation again' }));

    await waitFor(() => expect(played).toHaveLength(1));
    // The never-routed element: the browser's default output.
    expect(played[0].sink).toBe('');
  });

  it('explains an unsupported browser and offers the explicit fallback', async () => {
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    renderPanel();

    expect(screen.getByTestId('audio-routing-status')).toHaveTextContent('This browser cannot send each person’s translation');
    expect(screen.queryByLabelText('Staff hears — laptop speaker')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Allow a shared output/)).not.toBeChecked();
  });

  it('sets the staff speaker’s own volume, starting moderate', async () => {
    renderPanel();
    await chooseDevices();

    const slider = screen.getByLabelText(/Staff speaker volume/);
    expect(slider).toHaveValue('70');

    await turn('My turn — Speak');
    await waitFor(() => expect(played).toHaveLength(1));
    expect(played[0].element.volume).toBeCloseTo(0.7);
  });
});

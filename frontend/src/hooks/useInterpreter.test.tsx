import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterpreterAudioOutput, InterpreterPlaybackOutcome } from '@/lib/interpreterAudioOutput';
import { fakeMicrophoneControls as mic } from '@/test/fakeMicrophone';
import { ApiError } from '@/types/api';
import type { InterpreterClient, InterpreterLanguage } from '@/types/interpreter';
import { useInterpreter } from './useInterpreter';

/**
 * The interpreter's turn-taking, against scripted stand-ins.
 *
 * Real: useInterpreter. Stand-ins: the microphone (the fake honours
 * useMicrophone's contract and ends a recording the way end-of-speech
 * detection does), the interpreter client (no server, no LLM) and the audio
 * output (playback is settled by hand). No microphone, speaker or network.
 */

vi.mock('@/hooks/useMicrophone', async () => ({
  useMicrophone: (await import('@/test/fakeMicrophone')).fakeUseMicrophone,
}));

const LANGUAGES: InterpreterLanguage[] = [
  { code: 'en', name: 'English', speech: true },
  { code: 'kn', name: 'Kannada', speech: true },
  { code: 'hi', name: 'Hindi', speech: true },
  { code: 'ta', name: 'Tamil', speech: false },
];

const HEARD: Record<string, string> = {
  kn: 'ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಬೇಕು',
  en: 'Please fill in this deposit slip',
  hi: 'कृपया यहाँ हस्ताक्षर करें',
  ta: 'இங்கே கையொப்பமிடுங்கள்',
};

function translationOf(text: string, target: string): string {
  return `[${target}] ${text}`;
}

function scriptedClient() {
  return {
    languages: vi.fn(async () => LANGUAGES),
    transcribe: vi.fn(async ({ language }: { language: string }) => ({
      text: HEARD[language],
      language,
    })),
    translate: vi.fn(async ({ text, targetLanguage }: { text: string; targetLanguage: string }) => ({
      translation: translationOf(text, targetLanguage),
    })),
    speak: vi.fn(async () => new Blob([new Uint8Array(16)], { type: 'audio/mpeg' })),
  } satisfies InterpreterClient;
}

/** Playback that settles only when the test says so. */
function scriptedOutput() {
  const pending: Array<(outcome: InterpreterPlaybackOutcome) => void> = [];
  const output = {
    play: vi.fn(
      (_audio: Blob, _listener: 'customer' | 'staff') =>
        new Promise<InterpreterPlaybackOutcome>((resolve) => pending.push(resolve)),
    ),
    stop: vi.fn(),
    unlock: vi.fn(),
  } satisfies InterpreterAudioOutput;

  return {
    output,
    finish: (outcome: InterpreterPlaybackOutcome = 'ended') =>
      act(async () => {
        pending.shift()?.(outcome);
      }),
  };
}

let client: ReturnType<typeof scriptedClient>;
let audio: ReturnType<typeof scriptedOutput>;

beforeEach(() => {
  mic.reset();
  client = scriptedClient();
  audio = scriptedOutput();
});

async function renderInterpreter(customerLanguage = 'kn') {
  const hook = renderHook(() =>
    useInterpreter({ sessionId: 'sess-1', customerLanguage, client, output: audio.output }),
  );
  await waitFor(() => expect(hook.result.current.languagesStatus).toBe('ready'));
  return hook;
}

type Hook = Awaited<ReturnType<typeof renderInterpreter>>;

/** The speaker finishes; end-of-speech detection submits the recording. */
async function speaks(hook: Hook, party: 'customer' | 'staff') {
  act(() => hook.result.current.startTurn(party));
  expect(hook.result.current.phase).toBe('listening');
  act(() => mic.endpoint!('speech_ended'));
}

/** A whole turn, through to the translation being played and finished. */
async function fullTurn(hook: Hook, party: 'customer' | 'staff') {
  await speaks(hook, party);
  await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
  await audio.finish('ended');
  await waitFor(() => expect(hook.result.current.phase).toBe('awaiting_next_turn'));
}

describe('useInterpreter', () => {
  describe('languages', () => {
    it('takes the customer language from the visit and offers staff the others', async () => {
      const hook = await renderInterpreter('kn');

      expect(hook.result.current.customer?.name).toBe('Kannada');
      expect(hook.result.current.staffChoices.map((l) => l.code)).toEqual(['en', 'hi', 'ta']);
      expect(hook.result.current.staffLanguage).toBe('en');
      expect(hook.result.current.phase).toBe('idle');
      expect(hook.result.current.canSpeak).toBe(true);
    });

    it('lets staff choose their language', async () => {
      const hook = await renderInterpreter('kn');

      act(() => hook.result.current.setStaffLanguage('ta'));

      expect(hook.result.current.staffLanguage).toBe('ta');
    });

    it('cannot start when the customer language is not offered', async () => {
      const hook = await renderInterpreter('tcy');

      expect(hook.result.current.customer).toBeNull();
      expect(hook.result.current.canSpeak).toBe(false);
      act(() => hook.result.current.startTurn('customer'));
      expect(mic.attempts).toBe(0);
    });

    it('reports languages that could not be loaded, and can load them again', async () => {
      client.languages.mockRejectedValueOnce(new ApiError('down', 502));
      const hook = renderHook(() =>
        useInterpreter({ sessionId: 'sess-1', customerLanguage: 'kn', client, output: audio.output }),
      );

      await waitFor(() => expect(hook.result.current.languagesStatus).toBe('error'));
      expect(hook.result.current.canSpeak).toBe(false);

      act(() => hook.result.current.reloadLanguages());
      await waitFor(() => expect(hook.result.current.languagesStatus).toBe('ready'));
    });
  });

  describe('a turn', () => {
    it('customer to staff: recognised in Kannada, translated into the staff language, played for staff', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.setStaffLanguage('hi'));

      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));

      expect(client.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1', language: 'kn' }),
        expect.anything(),
      );
      expect(client.translate).toHaveBeenCalledWith(
        { sessionId: 'sess-1', text: HEARD.kn, sourceLanguage: 'kn', targetLanguage: 'hi' },
        expect.anything(),
      );
      expect(client.speak).toHaveBeenCalledWith(
        { sessionId: 'sess-1', text: translationOf(HEARD.kn, 'hi'), language: 'hi' },
        expect.anything(),
      );
      expect(audio.output.play.mock.calls[0][1]).toBe('staff');

      // The microphone stays closed while the translation plays.
      expect(mic.starts).toBe(1);

      await audio.finish('ended');
      await waitFor(() => expect(hook.result.current.phase).toBe('awaiting_next_turn'));

      expect(hook.result.current.entries).toEqual([
        expect.objectContaining({
          speaker: 'customer',
          sourceLanguage: 'kn',
          targetLanguage: 'hi',
          original: HEARD.kn,
          translation: translationOf(HEARD.kn, 'hi'),
          status: 'done',
        }),
      ]);
      expect(hook.result.current.nextSpeaker).toBe('staff');
    });

    it('staff to customer: the opposite direction, played for the customer', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.setStaffLanguage('en'));

      await fullTurn(hook, 'staff');

      expect(client.translate).toHaveBeenCalledWith(
        expect.objectContaining({ text: HEARD.en, sourceLanguage: 'en', targetLanguage: 'kn' }),
        expect.anything(),
      );
      expect(audio.output.play.mock.calls[0][1]).toBe('customer');
      expect(hook.result.current.entries[0]).toMatchObject({
        speaker: 'staff',
        original: HEARD.en,
        translation: translationOf(HEARD.en, 'kn'),
      });
      expect(hook.result.current.nextSpeaker).toBe('customer');
    });

    it('alternates for as many turns as are needed', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.setStaffLanguage('en'));

      await fullTurn(hook, 'customer');
      await fullTurn(hook, 'staff');
      await fullTurn(hook, 'customer');
      await fullTurn(hook, 'staff');

      expect(hook.result.current.entries.map((e) => e.speaker)).toEqual([
        'customer',
        'staff',
        'customer',
        'staff',
      ]);
      expect(hook.result.current.entries.every((e) => e.status === 'done')).toBe(true);
      expect(client.transcribe).toHaveBeenCalledTimes(4);
      expect(mic.starts).toBe(4);
    });

    it('shows a translation into a language without a voice, and says so instead of playing', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.setStaffLanguage('ta'));

      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('awaiting_next_turn'));

      expect(client.speak).not.toHaveBeenCalled();
      expect(audio.output.play).not.toHaveBeenCalled();
      expect(hook.result.current.entries[0]).toMatchObject({
        translation: translationOf(HEARD.kn, 'ta'),
        status: 'done',
      });
      expect(hook.result.current.entries[0].speechNote).toMatch(/Tamil is not available/);
    });

    it('can be finished early by hand', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.startTurn('customer'));

      act(() => hook.result.current.finishSpeaking());

      await waitFor(() => expect(client.transcribe).toHaveBeenCalledTimes(1));
    });
  });

  describe('nothing is invented', () => {
    it('asks the same speaker again when nothing was recognised, without an entry', async () => {
      client.transcribe.mockResolvedValueOnce({ text: '   ', language: 'kn' });
      const hook = await renderInterpreter('kn');

      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('error'));

      expect(hook.result.current.error).toMatchObject({ speaker: 'customer', retry: 'speak_again' });
      expect(hook.result.current.error?.message).toMatch(/customer, please speak again/i);
      expect(hook.result.current.entries).toHaveLength(0);
      expect(client.translate).not.toHaveBeenCalled();

      act(() => hook.result.current.retry());
      expect(hook.result.current.phase).toBe('listening');
      expect(mic.starts).toBe(2);
    });

    it('shows the server’s reason when recognition fails (422)', async () => {
      client.transcribe.mockRejectedValueOnce(
        new ApiError('I could not hear anything in that recording.', 422),
      );
      const hook = await renderInterpreter('kn');

      await speaks(hook, 'staff');
      await waitFor(() => expect(hook.result.current.phase).toBe('error'));

      expect(hook.result.current.error).toMatchObject({
        message: 'I could not hear anything in that recording.',
        speaker: 'staff',
        retry: 'speak_again',
      });
      expect(hook.result.current.entries).toHaveLength(0);
    });

    it('drops silence without sending anything', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.startTurn('customer'));

      act(() => mic.endpoint!('no_speech'));

      await waitFor(() => expect(hook.result.current.phase).toBe('error'));
      expect(hook.result.current.error?.message).toMatch(/did not hear anything/i);
      expect(client.transcribe).not.toHaveBeenCalled();
    });
  });

  describe('failures and retries', () => {
    it('keeps the original when translation fails, and retries only the translation', async () => {
      client.translate.mockRejectedValueOnce(
        new ApiError('The translation service is unavailable. Please try again.', 502),
      );
      const hook = await renderInterpreter('kn');

      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('error'));

      expect(hook.result.current.entries).toEqual([
        expect.objectContaining({ original: HEARD.kn, translation: null, status: 'failed' }),
      ]);
      expect(hook.result.current.error).toMatchObject({ retry: 'translate' });

      act(() => hook.result.current.retry());
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
      await audio.finish('ended');
      await waitFor(() => expect(hook.result.current.phase).toBe('awaiting_next_turn'));

      // The same entry, translated -- not a second one, and not re-recorded.
      expect(hook.result.current.entries).toHaveLength(1);
      expect(hook.result.current.entries[0]).toMatchObject({
        translation: translationOf(HEARD.kn, 'en'),
        status: 'done',
      });
      expect(client.transcribe).toHaveBeenCalledTimes(1);
      expect(client.translate).toHaveBeenCalledTimes(2);
      expect(mic.starts).toBe(1);
    });

    it('keeps earlier turns when a later one fails', async () => {
      const hook = await renderInterpreter('kn');
      await fullTurn(hook, 'customer');

      client.translate.mockRejectedValueOnce(new ApiError('Unavailable.', 502));
      await speaks(hook, 'staff');
      await waitFor(() => expect(hook.result.current.phase).toBe('error'));

      expect(hook.result.current.entries.map((e) => e.status)).toEqual(['done', 'failed']);
    });

    it('offers to play again when speech could not be fetched', async () => {
      client.speak.mockRejectedValueOnce(new ApiError('The spoken reply is unavailable right now.', 502));
      const hook = await renderInterpreter('kn');

      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('error'));

      expect(hook.result.current.error).toMatchObject({ retry: 'play' });
      // The translation itself is shown regardless.
      expect(hook.result.current.entries[0].translation).toBe(translationOf(HEARD.kn, 'en'));
      // The next speaker is not blocked by a missing sound.
      expect(hook.result.current.canSpeak).toBe(true);

      act(() => hook.result.current.retry());
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
      await audio.finish('ended');
      await waitFor(() => expect(hook.result.current.phase).toBe('awaiting_next_turn'));
      expect(client.translate).toHaveBeenCalledTimes(1);
    });

    it('offers to play again when the browser could not play it', async () => {
      const hook = await renderInterpreter('kn');

      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
      await audio.finish('failed');

      await waitFor(() => expect(hook.result.current.phase).toBe('error'));
      expect(hook.result.current.error).toMatchObject({ retry: 'play' });
    });

    it('says whose audio output is not ready when a translation could not be routed, and plays it once fixed', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.setStaffLanguage('en'));

      await speaks(hook, 'staff');
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
      expect(audio.output.play.mock.calls[0][1]).toBe('customer');
      await audio.finish('unrouted');

      await waitFor(() => expect(hook.result.current.phase).toBe('error'));
      expect(hook.result.current.error).toMatchObject({ retry: 'play', speaker: 'staff' });
      expect(hook.result.current.error?.message).toMatch(/for the customer was not played/);
      // The translation is still on screen.
      expect(hook.result.current.entries[0]).toMatchObject({
        translation: translationOf(HEARD.en, 'kn'),
        speechNote: 'Not played: no audio output is ready for the customer.',
      });

      // The headphones are reconnected; playing again reaches the same listener.
      act(() => hook.result.current.retry());
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
      expect(audio.output.play.mock.calls[1][1]).toBe('customer');
      await audio.finish('ended');
      await waitFor(() => expect(hook.result.current.phase).toBe('awaiting_next_turn'));
      expect(client.translate).toHaveBeenCalledTimes(1);
    });

    it('explains a refused microphone, and tries again when asked', async () => {
      mic.failWith = { status: 'denied', message: 'Microphone access is blocked.' };
      const hook = await renderInterpreter('kn');

      act(() => hook.result.current.startTurn('customer'));

      await waitFor(() => expect(hook.result.current.phase).toBe('error'));
      expect(hook.result.current.error).toMatchObject({
        message: 'Microphone access is blocked.',
        retry: 'speak_again',
      });

      // Permission granted in the browser; the customer asks again.
      mic.failWith = null;
      act(() => hook.result.current.retry());

      await waitFor(() => expect(mic.starts).toBe(1));
      expect(hook.result.current.phase).toBe('listening');
    });
  });

  describe('one thing at a time', () => {
    it('processes one recording once, however often it is reported', async () => {
      const hook = await renderInterpreter('kn');
      act(() => hook.result.current.startTurn('customer'));

      act(() => mic.endpoint!('speech_ended'));
      act(() => mic.endpoint!('speech_ended'));
      act(() => hook.result.current.finishSpeaking());

      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
      expect(client.transcribe).toHaveBeenCalledTimes(1);
      expect(hook.result.current.entries).toHaveLength(1);
    });

    it('opens one microphone for a double tap', async () => {
      const hook = await renderInterpreter('kn');

      act(() => {
        hook.result.current.startTurn('customer');
        hook.result.current.startTurn('customer');
        hook.result.current.startTurn('staff');
      });

      expect(mic.attempts).toBe(1);
      expect(hook.result.current.speaker).toBe('customer');
    });

    it('does not record while a translation is playing', async () => {
      const hook = await renderInterpreter('kn');
      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));

      expect(hook.result.current.canSpeak).toBe(false);
      act(() => hook.result.current.startTurn('staff'));

      expect(mic.attempts).toBe(1);
      expect(hook.result.current.phase).toBe('speaking');
    });

    it('a retry pressed twice translates once', async () => {
      client.translate.mockRejectedValueOnce(new ApiError('Unavailable.', 502));
      const hook = await renderInterpreter('kn');
      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('error'));

      act(() => {
        hook.result.current.retry();
        hook.result.current.retry();
      });

      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));
      expect(client.translate).toHaveBeenCalledTimes(2);
    });

    it('cancelling keeps what was said, and nothing late changes it', async () => {
      let settle!: (value: { translation: string }) => void;
      client.translate.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
      const hook = await renderInterpreter('kn');

      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('translating'));

      act(() => hook.result.current.cancel());
      expect(hook.result.current.phase).toBe('awaiting_next_turn');
      expect(hook.result.current.entries[0]).toMatchObject({ original: HEARD.kn, status: 'failed' });

      // The abandoned translation arrives anyway: ignored.
      await act(async () => settle({ translation: 'late' }));
      expect(hook.result.current.entries[0].translation).toBeNull();
      expect(client.speak).not.toHaveBeenCalled();
    });

    it('stops playback and abandons work when the screen goes away', async () => {
      const hook = await renderInterpreter('kn');
      await speaks(hook, 'customer');
      await waitFor(() => expect(hook.result.current.phase).toBe('speaking'));

      hook.unmount();

      expect(audio.output.stop).toHaveBeenCalled();
    });
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceContextValue } from '@/context/VoiceContext';
import { Composer } from './Composer';

function voice(overrides: Partial<VoiceContextValue> = {}): VoiceContextValue {
  return {
    preference: 'enabled',
    isEnabled: true,
    needsChoice: false,
    activity: 'idle',
    isBusy: false,
    micStatus: 'idle',
    micMessage: null,
    retryMicrophone: () => {},
    speechError: null,
    lastRecording: null,
    enable: () => {},
    disable: () => {},
    startListening: () => {},
    stopListening: () => {},
    submitUtterance: async () => {},
    startSpeaking: () => {},
    stopSpeaking: () => {},
    speak: async () => {},
    reset: () => {},
    ...overrides,
  };
}

const textBox = () => screen.getByRole('textbox', { name: /type your message/i });

describe('Composer', () => {
  it('sends on Enter and keeps Shift+Enter for a new line', async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} isSending={false} />);

    await userEvent.type(textBox(), 'first{Shift>}{Enter}{/Shift}second');

    expect(textBox()).toHaveValue('first\nsecond');
    expect(onSend).not.toHaveBeenCalled();

    await userEvent.type(textBox(), '{Enter}');

    expect(onSend).toHaveBeenCalledWith('first\nsecond');
  });

  it('shows no microphone while voice is off', () => {
    render(
      <Composer
        onSend={() => {}}
        isSending={false}
        voice={voice({ isEnabled: false, preference: 'disabled' })}
      />,
    );

    expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
  });

  describe('with voice on', () => {
    it('offers the microphone in place of Send until something is typed', async () => {
      const startListening = vi.fn();
      render(<Composer onSend={() => {}} isSending={false} voice={voice({ startListening })} />);

      expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /start voice input/i }));
      expect(startListening).toHaveBeenCalledTimes(1);

      await userEvent.type(textBox(), 'hello');

      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^send$/i })).toBeEnabled();
    });

    it('sends the recording when the customer stops listening', async () => {
      const stopListening = vi.fn();
      render(
        <Composer
          onSend={() => {}}
          isSending={false}
          voice={voice({ activity: 'listening', isBusy: true, stopListening })}
        />,
      );

      expect(screen.getByRole('status')).toHaveTextContent('Listening');

      await userEvent.click(screen.getByRole('button', { name: /stop listening/i }));

      expect(stopListening).toHaveBeenCalledTimes(1);
    });

    it('explains a refused microphone and offers a retry', async () => {
      const retryMicrophone = vi.fn();
      render(
        <Composer
          onSend={() => {}}
          isSending={false}
          voice={voice({
            micStatus: 'denied',
            micMessage: 'Microphone access is blocked.',
            retryMicrophone,
          })}
        />,
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Microphone access is blocked.');

      await userEvent.click(screen.getByRole('button', { name: /try the microphone again/i }));

      expect(retryMicrophone).toHaveBeenCalledTimes(1);
    });
  });
});

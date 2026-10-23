import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeVoice } from '@/test/fakeVoice';
import type { VoiceContextValue } from '@/context/VoiceContext';
import { VoiceConsole } from './VoiceConsole';

/**
 * The voice console shows the session's real state and moves it only
 * through the provider's own actions. The voice context is scripted; no
 * microphone, speaker or provider is involved.
 */

const REPLY = 'Fill in your account number. Let me know when you have completed it.';

function renderConsole(voice: VoiceContextValue, props: Partial<Parameters<typeof VoiceConsole>[0]> = {}) {
  const onHelp = vi.fn();
  const onActivity = vi.fn();
  render(
    <VoiceConsole
      voice={voice}
      isSending={false}
      ended={false}
      lastReply={REPLY}
      lastHeard="I want to deposit money"
      onHelp={onHelp}
      onActivity={onActivity}
      {...props}
    />,
  );
  return { onHelp, onActivity };
}

const orb = () => screen.getByRole('img');
const status = () => screen.getByTestId('voice-status');
const button = (name: RegExp | string) => screen.getByRole('button', { name });

describe('state shown', () => {
  it.each([
    ['idle', 'idle', /tap the microphone/i, 'Start voice input'],
    ['listening', 'listening', /listening/i, 'Stop listening'],
    ['processing', 'processing', /working on it/i, 'Sending what you said'],
    ['speaking', 'speaking', /speaking/i, 'Stop the assistant speaking'],
  ] as const)('%s', (activity, orbState, text, micLabel) => {
    renderConsole(fakeVoice({ activity }));

    expect(orb()).toHaveAttribute('data-state', orbState);
    expect(status()).toHaveTextContent(text);
    expect(button(micLabel)).toBeInTheDocument();
  });

  it('a typed request in flight shows as working, not as idle', () => {
    renderConsole(fakeVoice(), { isSending: true });

    expect(orb()).toHaveAttribute('data-state', 'processing');
  });

  it('is never "listening" unless the session is', () => {
    renderConsole(fakeVoice({ activity: 'speaking' }));

    expect(orb()).not.toHaveAttribute('data-state', 'listening');
    expect(screen.queryByRole('button', { name: 'Stop listening' })).toBeNull();
  });

  it('a refused microphone is an error with a way to retry', async () => {
    const voice = fakeVoice({ micStatus: 'denied', micMessage: 'Microphone access is blocked.' });
    renderConsole(voice);

    expect(orb()).toHaveAttribute('data-state', 'error');
    expect(status()).toHaveTextContent('Microphone access is blocked.');
    await userEvent.click(button(/try the microphone again/i));
    expect(voice.retryMicrophone).toHaveBeenCalledTimes(1);
  });

  it('a missing microphone offers no retry', () => {
    renderConsole(fakeVoice({ micStatus: 'unavailable', micMessage: 'No microphone was found.' }));

    expect(screen.queryByRole('button', { name: /try the microphone again/i })).toBeNull();
  });

  it('voice switched off offers to turn it on -- and nothing listens until then', async () => {
    const voice = fakeVoice({ preference: 'disabled', isEnabled: false });
    renderConsole(voice);

    expect(orb()).toHaveAttribute('data-state', 'off');
    expect(screen.queryByRole('button', { name: 'Start voice input' })).toBeNull();

    await userEvent.click(button('Turn on voice'));
    expect(voice.enable).toHaveBeenCalledTimes(1);
    expect(voice.startListening).not.toHaveBeenCalled();
  });

  it('has exactly one live region for voice announcements', () => {
    renderConsole(fakeVoice({ activity: 'listening' }));

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Listening');
  });
});

describe('controls', () => {
  it('the microphone starts, sends, and stops according to the state', async () => {
    const idle = fakeVoice();
    const { onActivity } = renderConsole(idle);
    await userEvent.click(button('Start voice input'));
    expect(idle.startListening).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalled();
  });

  it('pressing the microphone while listening sends what was said', async () => {
    const listening = fakeVoice({ activity: 'listening' });
    renderConsole(listening);
    await userEvent.click(button('Stop listening'));
    expect(listening.stopListening).toHaveBeenCalledTimes(1);
  });

  it('pressing the microphone while speaking stops speaking', async () => {
    const speaking = fakeVoice({ activity: 'speaking' });
    renderConsole(speaking);
    await userEvent.click(button('Stop the assistant speaking'));
    expect(speaking.reset).toHaveBeenCalledTimes(1);
  });

  it('replay reads the last reply again', async () => {
    const voice = fakeVoice();
    renderConsole(voice);

    await userEvent.click(button('Replay the last reply'));

    expect(voice.speak).toHaveBeenCalledWith(REPLY);
  });

  it.each([
    ['with no reply yet', fakeVoice(), { lastReply: null }],
    ['while listening', fakeVoice({ activity: 'listening' }), {}],
    ['while speaking', fakeVoice({ activity: 'speaking' }), {}],
    ['while a request is in flight', fakeVoice(), { isSending: true }],
    ['with voice off', fakeVoice({ isEnabled: false, preference: 'disabled' }), {}],
  ])('replay is unavailable %s', (_label, voice, props) => {
    renderConsole(voice, props);

    expect(button('Replay the last reply')).toBeDisabled();
  });

  it('help asks for help', async () => {
    const { onHelp, onActivity } = renderConsole(fakeVoice());

    await userEvent.click(button('Help with this step'));

    expect(onHelp).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalled();
  });

  it('stop returns everything to rest, and is only available when something is happening', async () => {
    const idle = fakeVoice();
    const { unmount } = render(
      <VoiceConsole voice={idle} isSending={false} ended={false} lastReply={null} lastHeard={null} onHelp={vi.fn()} />,
    );
    expect(button('Stop')).toBeDisabled();
    unmount();

    const listening = fakeVoice({ activity: 'listening' });
    renderConsole(listening);
    await userEvent.click(button('Stop'));
    expect(listening.reset).toHaveBeenCalledTimes(1);
  });

  it('after the visit ends nothing can be started', () => {
    renderConsole(fakeVoice(), { ended: true });

    expect(button('Start voice input')).toBeDisabled();
    expect(button('Help with this step')).toBeDisabled();
    expect(button('Replay the last reply')).toBeDisabled();
  });

  it('every control is reachable by keyboard', async () => {
    const voice = fakeVoice();
    renderConsole(voice);

    await userEvent.tab();
    expect(button('Start voice input')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(voice.startListening).toHaveBeenCalledTimes(1);

    await userEvent.tab();
    expect(button('Replay the last reply')).toHaveFocus();
    await userEvent.tab();
    expect(button('Help with this step')).toHaveFocus();
  });
});

describe('when the reply cannot be heard', () => {
  it('shows the reply itself as the text alternative', () => {
    renderConsole(
      fakeVoice({ speechError: 'The spoken reply is unavailable. The written answer is above.' }),
    );

    const alternative = screen.getAllByRole('status').find((node) => node.textContent?.includes(REPLY));
    expect(alternative).toBeDefined();
    expect(alternative).toHaveTextContent('The spoken reply is unavailable.');
  });
});

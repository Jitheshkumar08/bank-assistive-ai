import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceContext, type VoiceContextValue } from '@/context/VoiceContext';
import { VoiceOptInDialog } from './VoiceOptInDialog';

const enable = vi.fn();
const disable = vi.fn();

function voice(overrides: Partial<VoiceContextValue> = {}): VoiceContextValue {
  return {
    preference: 'unset',
    isEnabled: false,
    needsChoice: true,
    activity: 'idle',
    isBusy: false,
    micStatus: 'idle',
    micMessage: null,
    retryMicrophone: () => {},
    speechError: null,
    lastRecording: null,
    enable,
    disable,
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

function renderDialog(value = voice()) {
  return render(
    <VoiceContext.Provider value={value}>
      <button type="button">behind the dialog</button>
      <VoiceOptInDialog />
    </VoiceContext.Provider>,
  );
}

beforeEach(() => {
  enable.mockReset();
  disable.mockReset();
});

describe('VoiceOptInDialog', () => {
  describe('when the choice is still open', () => {
    it('asks as a modal dialog', () => {
      renderDialog();

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAccessibleName(/would you like voice assistance/i);
    });

    it('explains what enabling actually does', () => {
      renderDialog();

      // Consent needs the terms attached to it, not just a yes button.
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
        /microphone is only used while you are holding/i,
      );
    });

    it('moves focus into the dialog', () => {
      renderDialog();

      // Otherwise a keyboard user is left on the page underneath,
      // tabbing through content the dialog is covering.
      expect(screen.getByRole('dialog')).toHaveFocus();
    });

    it('keeps Tab inside the dialog', async () => {
      renderDialog();

      const close = screen.getByRole('button', { name: /close, and continue without voice/i });
      const text = screen.getByRole('button', { name: /continue with text/i });

      // From the last control, Tab wraps to the first rather than
      // escaping to the page behind.
      text.focus();
      await userEvent.tab();

      expect(close).toHaveFocus();
    });
  });

  describe('answering', () => {
    it('turns voice on', async () => {
      renderDialog();

      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));

      expect(enable).toHaveBeenCalledTimes(1);
      expect(disable).not.toHaveBeenCalled();
    });

    it('continues with text', async () => {
      renderDialog();

      await userEvent.click(screen.getByRole('button', { name: /continue with text/i }));

      expect(disable).toHaveBeenCalledTimes(1);
    });
  });

  describe('dismissing', () => {
    it('settles the choice rather than leaving it open', async () => {
      renderDialog();

      await userEvent.click(screen.getByRole('button', { name: /close, and continue without voice/i }));

      // Closing has to be an answer. An unanswered question would simply
      // be asked again on the next screen, which is the nagging this
      // dialog replaced.
      expect(disable).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape', async () => {
      renderDialog();

      await userEvent.keyboard('{Escape}');

      expect(disable).toHaveBeenCalledTimes(1);
    });

    it('closes when the backdrop is clicked', async () => {
      const { container } = renderDialog();

      const backdrop = container.querySelector('.fixed.inset-0');
      await userEvent.click(backdrop as Element);

      expect(disable).toHaveBeenCalledTimes(1);
    });

    it('stays open when the panel itself is clicked', async () => {
      renderDialog();

      await userEvent.click(screen.getByRole('heading', { level: 2 }));

      // A click inside bubbles up to the backdrop; without a guard that
      // would close the dialog the customer was reading.
      expect(disable).not.toHaveBeenCalled();
      expect(enable).not.toHaveBeenCalled();
    });
  });

  describe('once the choice is settled', () => {
    it.each(['enabled', 'disabled'] as const)('is gone when the preference is %s', (preference) => {
      renderDialog(voice({ preference, needsChoice: false, isEnabled: preference === 'enabled' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('stops listening for Escape', async () => {
      renderDialog(voice({ preference: 'enabled', needsChoice: false, isEnabled: true }));

      await userEvent.keyboard('{Escape}');

      // A handler left bound would keep turning voice off every time
      // the customer pressed Escape anywhere in the app.
      expect(disable).not.toHaveBeenCalled();
    });
  });
});

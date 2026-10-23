import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AssistanceOffer } from '@/types/assistant';
import { AssistanceCard } from './AssistanceCard';

const OFFER: AssistanceOffer = {
  offered: true,
  reason: 'offered',
  field: 'account_number',
  promptId: 'account_number.1',
  text: 'ನಿಧಾನವಾಗಿ ಮಾಡಿ. ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಲು ತೊಂದರೆಯಾಗುತ್ತಿದೆಯೇ?',
};

describe('AssistanceCard', () => {
  it('shows nothing when no step is in progress and nothing was offered', () => {
    const { container } = render(<AssistanceCard offer={null} stepInProgress={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('on a step, says how to get help', () => {
    render(<AssistanceCard offer={null} stepInProgress />);

    expect(screen.getByRole('region', { name: 'Help with this step' })).toHaveTextContent(
      /tap help or say “help”/i,
    );
  });

  it('shows an offer as the assistant worded it, with the field it is about, and announces it', () => {
    render(<AssistanceCard offer={OFFER} stepInProgress />);

    expect(screen.getByRole('status')).toHaveTextContent(OFFER.text!);
    expect(screen.getByText('Account number')).toBeInTheDocument();
    expect(screen.queryByText(/tap help or say/i)).toBeNull();
  });

  it('ignores an answer that offered nothing', () => {
    render(
      <AssistanceCard
        offer={{ offered: false, reason: 'paused', field: null, promptId: null, text: null }}
        stepInProgress={false}
      />,
    );

    expect(screen.queryByRole('region')).toBeNull();
  });

  it('can be dismissed, and offers Help when asked to carry it', async () => {
    const onDismiss = vi.fn();
    const onHelp = vi.fn();
    render(<AssistanceCard offer={OFFER} stepInProgress onHelp={onHelp} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole('button', { name: 'Help' }));
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(onHelp).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowSnapshot } from '@/types/assistant';
import { WorkflowProgress } from './WorkflowProgress';

function snapshot(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return { name: 'deposit money', state: 'active', step: 2, totalSteps: 4, ...overrides };
}

const panel = () => screen.queryByRole('region', { name: /current task/i });
const bar = () => screen.queryByRole('progressbar');

describe('WorkflowProgress', () => {
  it.each([
    ['no snapshot', null],
    ['no workflow', snapshot({ name: null, state: 'none', step: null, totalSteps: null })],
    ['a state with no name', snapshot({ name: null })],
  ])('renders nothing for %s', (_label, workflow) => {
    render(<WorkflowProgress workflow={workflow} />);

    expect(panel()).not.toBeInTheDocument();
  });

  it('shows the task, its step and how much is done', () => {
    render(<WorkflowProgress workflow={snapshot()} />);

    expect(screen.getByText('Deposit money')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    // On step 2, one step is behind the customer.
    expect(bar()).toHaveAttribute('aria-valuenow', '1');
    expect(bar()).toHaveAttribute('aria-valuemax', '4');
  });

  it('shows a completed task as complete, never as "5 of 4"', () => {
    render(<WorkflowProgress workflow={snapshot({ state: 'completed', step: 5 })} />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText(/5 of 4/)).not.toBeInTheDocument();
    expect(bar()).toHaveAttribute('aria-valuenow', '4');
  });

  it('shows where a paused task stopped', () => {
    render(<WorkflowProgress workflow={snapshot({ state: 'suspended' })} />);

    expect(screen.getByText('Paused at step 2 of 4')).toBeInTheDocument();
  });

  it('shows a cancelled task without progress', () => {
    render(<WorkflowProgress workflow={snapshot({ state: 'cancelled' })} />);

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
  });

  it('does not invent a total the engine did not send', () => {
    render(<WorkflowProgress workflow={snapshot({ totalSteps: null })} />);

    expect(screen.getByText('Step 2')).toBeInTheDocument();
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
  });
});

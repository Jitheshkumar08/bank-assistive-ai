import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AccountLayout } from './AccountLayout';

/** Stands in for the sign-in form, and shows where it would send them. */
function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? 'nowhere';

  return <p>login form, heading to {from}</p>;
}

function renderAccount(pathname: string, state: unknown = null) {
  const router = createMemoryRouter(
    [
      {
        element: <AccountLayout />,
        children: [
          { path: '/login', element: <LoginProbe /> },
          { path: '/register', element: <p>register form</p> },
        ],
      },
      { path: '/', element: <p>home screen</p> },
    ],
    { initialEntries: [{ pathname, state }] },
  );

  return render(<RouterProvider router={router} />);
}

const toggle = () => screen.getByRole('navigation', { name: 'Account' });

describe('AccountLayout', () => {
  it('shows the form inside the main landmark', () => {
    renderAccount('/login');

    expect(within(screen.getByRole('main')).getByText(/login form/)).toBeInTheDocument();
  });

  it('marks which form is open', () => {
    renderAccount('/login');

    expect(within(toggle()).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(toggle()).getByRole('link', { name: 'Create account' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('switches to registration', async () => {
    renderAccount('/login');

    await userEvent.click(within(toggle()).getByRole('link', { name: 'Create account' }));

    expect(await screen.findByText('register form')).toBeInTheDocument();
    expect(within(toggle()).getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps the toggle itself in place while the form beneath it changes', async () => {
    renderAccount('/login');
    const before = toggle();

    await userEvent.click(within(before).getByRole('link', { name: 'Create account' }));
    await screen.findByText('register form');

    // The same element, not a new one: that is what lets the highlight
    // slide across instead of the whole card reloading.
    expect(toggle()).toBe(before);
  });

  it('remembers where the customer was heading across a switch and back', async () => {
    renderAccount('/login', { from: '/welcome' });

    await userEvent.click(within(toggle()).getByRole('link', { name: 'Create account' }));
    await screen.findByText('register form');
    await userEvent.click(within(toggle()).getByRole('link', { name: 'Sign in' }));

    // Sent here from a protected screen, they still return there once
    // signed in -- even after a detour to the other form.
    expect(await screen.findByText('login form, heading to /welcome')).toBeInTheDocument();
  });

  it('leads back to the home page from the name', async () => {
    renderAccount('/login');

    await userEvent.click(screen.getByRole('link', { name: 'Banking Assistant' }));

    expect(await screen.findByText('home screen')).toBeInTheDocument();
  });

  it('keeps the decorative illustrations away from screen readers', () => {
    renderAccount('/login');

    const illustrations = screen.getAllByText('Fill in your account number');
    expect(illustrations.length).toBeGreaterThan(0);

    for (const element of illustrations) {
      expect(element.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { RegisterPage } from './RegisterPage';
import { ApiError } from '@/types/api';
import type { RegisterRequest } from '@/types/auth';

const register = vi.fn<(details: RegisterRequest) => Promise<void>>();

function auth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    isAuthenticated: false,
    isRestoring: false,
    login: async () => {},
    register,
    updateProfile: async () => {},
    changePassword: async () => {},
    logout: () => {},
    ...overrides,
  };
}

function renderRegister(authValue = auth()) {
  const router = createMemoryRouter(
    [
      { path: '/register', element: <RegisterPage /> },
      { path: '/scan', element: <p>scan screen</p> },
      { path: '/login', element: <p>login screen</p> },
    ],
    { initialEntries: ['/register'] },
  );

  return render(
    <AuthContext.Provider value={authValue}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}

/** Fills every required field with something valid. */
async function fillValidForm() {
  await userEvent.type(screen.getByLabelText(/full name/i), 'Anita Rao');
  await userEvent.type(screen.getByLabelText(/email/i), 'anita@example.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'StrongPass123!');
}

beforeEach(() => {
  register.mockReset();
  register.mockResolvedValue(undefined);
});

describe('RegisterPage', () => {
  describe('the form', () => {
    it('asks for a name, because the assistant speaks it back', () => {
      renderRegister();

      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('offers every language the assistant can actually speak', () => {
      renderRegister();

      // Written in their own scripts: a list that says "Kannada" in
      // English is useless to the person who needs it.
      expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /ಕನ್ನಡ/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /हिन्दी/ })).toBeInTheDocument();
    });

    it('starts on English so the form is never submitted without a language', () => {
      renderRegister();

      expect(screen.getByRole('radio', { name: /English/ })).toBeChecked();
    });

    it('marks the phone number as optional', () => {
      renderRegister();

      expect(screen.getByLabelText(/phone/i)).not.toBeRequired();
    });
  });

  describe('creating an account', () => {
    it('submits the details and continues to the scan screen', async () => {
      renderRegister();
      await fillValidForm();

      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() =>
        expect(register).toHaveBeenCalledWith({
          email: 'anita@example.com',
          fullName: 'Anita Rao',
          password: 'StrongPass123!',
          preferredLanguage: 'en',
        }),
      );

      // Registering signs them in, so they go where a returning
      // customer goes -- not back to the sign-in form.
      expect(await screen.findByText('scan screen')).toBeInTheDocument();
    });

    it('sends the chosen language, not the default', async () => {
      renderRegister();
      await fillValidForm();

      await userEvent.click(screen.getByRole('radio', { name: /ಕನ್ನಡ/ }));
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      // This is what decides the assistant's voice for every visit.
      await waitFor(() =>
        expect(register.mock.calls[0][0]).toMatchObject({ preferredLanguage: 'kn' }),
      );
    });

    it('trims surrounding whitespace from what was typed', async () => {
      renderRegister();

      await userEvent.type(screen.getByLabelText(/full name/i), '  Anita Rao  ');
      await userEvent.type(screen.getByLabelText(/email/i), '  anita@example.com  ');
      await userEvent.type(screen.getByLabelText(/password/i), 'StrongPass123!');
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() =>
        expect(register.mock.calls[0][0]).toMatchObject({
          fullName: 'Anita Rao',
          email: 'anita@example.com',
        }),
      );
    });

    it('omits the phone number entirely when it is left blank', async () => {
      renderRegister();
      await fillValidForm();

      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      // Sending "" would fail the API's phone format check, turning an
      // untouched optional field into a rejected form.
      await waitFor(() => expect(register).toHaveBeenCalled());
      expect(register.mock.calls[0][0]).not.toHaveProperty('phone');
    });

    it('includes the phone number when one is given', async () => {
      renderRegister();
      await fillValidForm();
      await userEvent.type(screen.getByLabelText(/phone/i), '+91 98765 43210');

      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() =>
        expect(register.mock.calls[0][0]).toMatchObject({ phone: '+91 98765 43210' }),
      );
    });
  });

  describe('validation before the request', () => {
    it('will not submit an empty form', async () => {
      renderRegister();

      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(register).not.toHaveBeenCalled();
      expect(await screen.findByText('Enter your full name.')).toBeInTheDocument();
    });

    it('rejects a password shorter than the API accepts', async () => {
      renderRegister();

      await userEvent.type(screen.getByLabelText(/full name/i), 'Anita Rao');
      await userEvent.type(screen.getByLabelText(/email/i), 'anita@example.com');
      await userEvent.type(screen.getByLabelText(/password/i), 'short');
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      // Caught here rather than after a round trip that was always
      // going to fail.
      expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
      expect(register).not.toHaveBeenCalled();
    });

    it('rejects a phone number that is not one', async () => {
      renderRegister();
      await fillValidForm();
      await userEvent.type(screen.getByLabelText(/phone/i), 'call me maybe');

      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/valid phone number/i)).toBeInTheDocument();
      expect(register).not.toHaveBeenCalled();
    });

    it('lets a corrected form through', async () => {
      renderRegister();

      await userEvent.click(screen.getByRole('button', { name: /create account/i }));
      expect(await screen.findByText('Enter your full name.')).toBeInTheDocument();

      await fillValidForm();
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    });
  });

  describe('when the API refuses', () => {
    it('shows the reason rather than a generic failure', async () => {
      register.mockRejectedValue(
        new ApiError('An account with that email already exists.', 409),
      );

      renderRegister();
      await fillValidForm();
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    });

    it('lets them try again after a failure', async () => {
      register.mockRejectedValueOnce(new ApiError('Service unavailable.', 503));

      renderRegister();
      await fillValidForm();
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      await screen.findByRole('alert');

      // The button has to come back, or a transient outage traps them
      // on a form they cannot resubmit.
      const submit = screen.getByRole('button', { name: /create account/i });
      expect(submit).toBeEnabled();

      await userEvent.click(submit);
      await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    });

    it('reports an unreachable server without leaking the exception', async () => {
      register.mockRejectedValue(new TypeError('Failed to fetch'));

      renderRegister();
      await fillValidForm();
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    });
  });

  it('offers a way back to signing in', async () => {
    renderRegister();

    await userEvent.click(screen.getByRole('link', { name: /sign in/i }));

    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });
});

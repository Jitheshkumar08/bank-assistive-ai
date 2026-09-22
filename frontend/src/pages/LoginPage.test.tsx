import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { LoginPage } from './LoginPage';
import { ApiError } from '@/types/api';
import type { AuthenticatedUser, LoginRequest } from '@/types/auth';

const CUSTOMER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Demo Customer',
  preferredLanguage: 'en',
  role: 'CUSTOMER',
};

const ADMIN: AuthenticatedUser = { ...CUSTOMER, id: 'a1', fullName: 'Administrator', role: 'ADMIN' };

const login = vi.fn<(credentials: LoginRequest) => Promise<AuthenticatedUser>>();

function auth(): AuthContextValue {
  return {
    user: null,
    isAuthenticated: false,
    isRestoring: false,
    login,
    register: async () => {},
    updateProfile: async () => {},
    changePassword: async () => {},
    logout: () => {},
  };
}

function renderLogin(from?: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/scan', element: <p>scan screen</p> },
      { path: '/welcome', element: <p>welcome screen</p> },
      { path: '/register', element: <p>register screen</p> },
      { path: '/admin', element: <p>admin screen</p> },
    ],
    { initialEntries: [{ pathname: '/login', state: from ? { from } : null }] },
  );

  return render(
    <AuthContext.Provider value={auth()}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}

const emailField = () => screen.getByLabelText(/^email/i);
const passwordField = () => screen.getByLabelText(/^password/i);
const signInButton = () => screen.getByRole('button', { name: /sign in/i });

async function fillIn(email = 'anita@example.com', password = 'StrongPass123!') {
  await userEvent.type(emailField(), email);
  await userEvent.type(passwordField(), password);
}

beforeEach(() => {
  login.mockReset();
  login.mockResolvedValue(CUSTOMER);
});

describe('LoginPage', () => {
  describe('the form', () => {
    it('greets a returning customer and asks for their details', () => {
      renderLogin();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back');
      expect(emailField()).toHaveAttribute('type', 'email');
      expect(passwordField()).toHaveAttribute('type', 'password');
    });

    it('announces both fields as required without cluttering them with asterisks', () => {
      renderLogin();

      expect(emailField()).toHaveAttribute('aria-required', 'true');
      expect(passwordField()).toHaveAttribute('aria-required', 'true');
      expect(screen.queryByText('*')).not.toBeInTheDocument();
    });

    it('lets a password manager fill it in', () => {
      renderLogin();

      expect(emailField()).toHaveAttribute('autocomplete', 'email');
      expect(passwordField()).toHaveAttribute('autocomplete', 'current-password');
    });
  });

  describe('showing the password', () => {
    it('reveals and hides what was typed', async () => {
      renderLogin();
      await userEvent.type(passwordField(), 'StrongPass123!');

      await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
      expect(passwordField()).toHaveAttribute('type', 'text');
      expect(passwordField()).toHaveValue('StrongPass123!');

      await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
      expect(passwordField()).toHaveAttribute('type', 'password');
    });

    it('never submits the form', async () => {
      renderLogin();
      await fillIn();

      await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

      // Inside a form a button submits by default: one tap to check the
      // password would sign in before the customer had finished checking.
      expect(login).not.toHaveBeenCalled();
    });
  });

  describe('signing in', () => {
    it('sends staff to the branch admin screen instead', async () => {
      login.mockResolvedValue(ADMIN);
      renderLogin();
      await fillIn('admin@bankassist.local');

      await userEvent.click(signInButton());

      // Staff have no branch to scan into; their screen is the one that
      // manages branches and their QR codes.
      expect(await screen.findByText('admin screen')).toBeInTheDocument();
    });

    it('sends the details and continues to the scan screen', async () => {
      renderLogin();
      await fillIn('  anita@example.com  ');

      await userEvent.click(signInButton());

      await waitFor(() =>
        expect(login).toHaveBeenCalledWith({
          email: 'anita@example.com',
          password: 'StrongPass123!',
        }),
      );
      expect(await screen.findByText('scan screen')).toBeInTheDocument();
    });

    it('returns to wherever the customer was heading', async () => {
      renderLogin('/welcome');
      await fillIn();

      await userEvent.click(signInButton());

      expect(await screen.findByText('welcome screen')).toBeInTheDocument();
    });

    it('shows the reason a sign-in was refused, and lets them try again', async () => {
      login.mockRejectedValue(new ApiError('Email or password is incorrect.', 401));

      renderLogin();
      await fillIn();
      await userEvent.click(signInButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
      expect(signInButton()).toBeEnabled();
    });

    it('does not surface the raw exception from an unexpected failure', async () => {
      login.mockRejectedValue(new TypeError('Failed to fetch'));

      renderLogin();
      await fillIn();
      await userEvent.click(signInButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    });

    it('cannot be sent twice while a sign-in is in flight', async () => {
      let settle!: (account: AuthenticatedUser) => void;
      login.mockReturnValue(new Promise<AuthenticatedUser>((resolve) => (settle = resolve)));

      renderLogin();
      await fillIn();
      await userEvent.click(signInButton());

      const busy = await screen.findByRole('button', { name: /signing in/i });
      expect(busy).toBeDisabled();

      await userEvent.click(busy);
      expect(login).toHaveBeenCalledTimes(1);

      settle(CUSTOMER);
      expect(await screen.findByText('scan screen')).toBeInTheDocument();
    });
  });
});

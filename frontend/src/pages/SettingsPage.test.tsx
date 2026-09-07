import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SettingsPage } from './SettingsPage';
import { ApiError } from '@/types/api';
import type { AuthenticatedUser, ChangePasswordRequest, UpdateProfileRequest } from '@/types/auth';

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'anita@example.com',
  fullName: 'Anita Rao',
  preferredLanguage: 'en',
};

const updateProfile = vi.fn<(changes: UpdateProfileRequest) => Promise<void>>();
const changePassword = vi.fn<(change: ChangePasswordRequest) => Promise<void>>();

function auth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: USER,
    isAuthenticated: true,
    isRestoring: false,
    login: async () => {},
    register: async () => {},
    updateProfile,
    changePassword,
    logout: () => {},
    ...overrides,
  };
}

function renderSettings(authValue = auth()) {
  const router = createMemoryRouter(
    [
      { path: '/settings', element: <SettingsPage /> },
      { path: '/scan', element: <p>scan screen</p> },
      { path: '/login', element: <p>login screen</p> },
    ],
    { initialEntries: ['/settings'] },
  );

  return render(
    <AuthContext.Provider value={authValue}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}

const saveButton = () => screen.getByRole('button', { name: /save changes/i });
const nameField = () => screen.getByLabelText(/full name/i);
const emailField = () => screen.getByLabelText(/^email/i);

beforeEach(() => {
  updateProfile.mockReset();
  updateProfile.mockResolvedValue(undefined);
  changePassword.mockReset();
  changePassword.mockResolvedValue(undefined);
});

describe('SettingsPage', () => {
  describe('what it shows', () => {
    it('starts from the account as it is now', () => {
      renderSettings();

      expect(nameField()).toHaveValue('Anita Rao');
      expect(emailField()).toHaveValue('anita@example.com');
      expect(screen.getByRole('radio', { name: /English/ })).toBeChecked();
    });

    it('cannot be saved until something changes', () => {
      renderSettings();

      // A save button that does nothing still teaches people to press
      // buttons that do nothing.
      expect(saveButton()).toBeDisabled();
    });

    it('does not ask for a password until the email changes', async () => {
      renderSettings();

      expect(screen.queryByLabelText(/confirm your password/i)).not.toBeInTheDocument();

      await userEvent.clear(emailField());
      await userEvent.type(emailField(), 'new@example.com');

      expect(await screen.findByLabelText(/confirm your password/i)).toBeInTheDocument();
    });
  });

  describe('changing details', () => {
    it('sends only what actually changed', async () => {
      renderSettings();

      await userEvent.clear(nameField());
      await userEvent.type(nameField(), 'Anita Shetty');
      await userEvent.click(saveButton());

      // Resending untouched fields would overwrite a change made
      // elsewhere with the copy this form loaded minutes ago.
      await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ fullName: 'Anita Shetty' }));
    });

    it('changes the language on its own, without a password', async () => {
      renderSettings();

      await userEvent.click(screen.getByRole('radio', { name: /ಕನ್ನಡ/ }));
      await userEvent.click(saveButton());

      await waitFor(() =>
        expect(updateProfile).toHaveBeenCalledWith({ preferredLanguage: 'kn' }),
      );
    });

    it('sends the password alongside a new email', async () => {
      renderSettings();

      await userEvent.clear(emailField());
      await userEvent.type(emailField(), 'moved@example.com');
      await userEvent.type(await screen.findByLabelText(/confirm your password/i), 'StrongPass123!');
      await userEvent.click(saveButton());

      await waitFor(() =>
        expect(updateProfile).toHaveBeenCalledWith({
          email: 'moved@example.com',
          currentPassword: 'StrongPass123!',
        }),
      );
    });

    it('confirms that the change was saved', async () => {
      renderSettings();

      await userEvent.clear(nameField());
      await userEvent.type(nameField(), 'Anita Shetty');
      await userEvent.click(saveButton());

      expect(await screen.findByText(/details have been saved/i)).toBeInTheDocument();
    });

    it('still confirms the save once the account really changes', async () => {
      // The mocked provider above never changes `user`, so it cannot
      // catch this: in the real app a successful save updates the
      // account, which re-keys the form and remounts it. A banner the
      // form kept for itself is destroyed by the very save it reports.
      function StatefulSettings() {
        const [current, setCurrent] = useState(USER);

        const router = createMemoryRouter(
          [
            { path: '/settings', element: <SettingsPage /> },
            { path: '/scan', element: <p>scan screen</p> },
          ],
          { initialEntries: ['/settings'] },
        );

        return (
          <AuthContext.Provider
            value={auth({
              user: current,
              updateProfile: async (changes) => {
                setCurrent((previous) => ({ ...previous, ...changes }));
              },
            })}
          >
            <RouterProvider router={router} />
          </AuthContext.Provider>
        );
      }

      render(<StatefulSettings />);

      await userEvent.clear(nameField());
      await userEvent.type(nameField(), 'Anita Shetty');
      await userEvent.click(saveButton());

      expect(await screen.findByText(/details have been saved/i)).toBeInTheDocument();
      // And the form is now baselined against the saved value.
      expect(nameField()).toHaveValue('Anita Shetty');
      expect(saveButton()).toBeDisabled();
    });

    it('refuses to submit a name that is too short', async () => {
      renderSettings();

      await userEvent.clear(nameField());
      await userEvent.type(nameField(), 'A');
      await userEvent.click(saveButton());

      expect(await screen.findByText('Enter your full name.')).toBeInTheDocument();
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('shows the reason the API refused', async () => {
      updateProfile.mockRejectedValue(
        new ApiError('An account with that email already exists.', 409),
      );

      renderSettings();

      await userEvent.clear(emailField());
      await userEvent.type(emailField(), 'taken@example.com');
      await userEvent.type(await screen.findByLabelText(/confirm your password/i), 'StrongPass123!');
      await userEvent.click(saveButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    });

    it('lets them try again after a failure', async () => {
      updateProfile.mockRejectedValueOnce(new ApiError('Service unavailable.', 503));

      renderSettings();

      await userEvent.clear(nameField());
      await userEvent.type(nameField(), 'Anita Shetty');
      await userEvent.click(saveButton());
      await screen.findByRole('alert');

      expect(saveButton()).toBeEnabled();
      await userEvent.click(saveButton());

      await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(2));
    });
  });

  describe('changing a password', () => {
    const currentField = () => screen.getByLabelText(/current password/i);
    const newField = () => screen.getByLabelText(/new password/i);
    const changeButton = () => screen.getByRole('button', { name: /change password/i });

    it('sends both passwords', async () => {
      renderSettings();

      await userEvent.type(currentField(), 'StrongPass123!');
      await userEvent.type(newField(), 'EvenStronger456!');
      await userEvent.click(changeButton());

      await waitFor(() =>
        expect(changePassword).toHaveBeenCalledWith({
          currentPassword: 'StrongPass123!',
          newPassword: 'EvenStronger456!',
        }),
      );
    });

    it('will not send a new password the API would reject', async () => {
      renderSettings();

      await userEvent.type(currentField(), 'StrongPass123!');
      await userEvent.type(newField(), 'short');
      await userEvent.click(changeButton());

      expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
      expect(changePassword).not.toHaveBeenCalled();
    });

    it('clears both fields once the password is changed', async () => {
      renderSettings();

      await userEvent.type(currentField(), 'StrongPass123!');
      await userEvent.type(newField(), 'EvenStronger456!');
      await userEvent.click(changeButton());

      await screen.findByText(/password has been changed/i);

      // A password left sitting in a form field on a shared branch
      // device is a password on display.
      expect(currentField()).toHaveValue('');
      expect(newField()).toHaveValue('');
    });

    it('keeps what was typed when the password was wrong', async () => {
      changePassword.mockRejectedValue(new ApiError('That password is not correct.', 401));

      renderSettings();

      await userEvent.type(currentField(), 'WrongPass123!');
      await userEvent.type(newField(), 'EvenStronger456!');
      await userEvent.click(changeButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(/not correct/i);
      // Retyping a long new password because the old one was mistyped
      // would be punishment for a typo.
      expect(newField()).toHaveValue('EvenStronger456!');
    });

    it('does not touch the details form', async () => {
      renderSettings();

      await userEvent.type(currentField(), 'StrongPass123!');
      await userEvent.type(newField(), 'EvenStronger456!');
      await userEvent.click(changeButton());

      await waitFor(() => expect(changePassword).toHaveBeenCalled());
      expect(updateProfile).not.toHaveBeenCalled();
    });
  });

  it('sends a signed-out visitor to sign in', () => {
    renderSettings(auth({ user: null, isAuthenticated: false }));

    expect(screen.getByText('login screen')).toBeInTheDocument();
  });
});

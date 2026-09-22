import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { RequireAuth } from './RequireAuth';
import { RequireContext } from './RequireContext';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Demo Customer',
  preferredLanguage: 'en',
  role: 'CUSTOMER',
};

const SESSION: Session = {
  id: 's1',
  status: 'ACTIVE',
  language: 'en',
  startedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  endedAt: null,
  branch: { id: 'b1', code: 'BR001', name: 'Surathkal Branch', city: 'Mangaluru' },
};

function auth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    isAuthenticated: false,
    isRestoring: false,
    login: async () => USER,
    register: async () => {},
    updateProfile: async () => {},
    changePassword: async () => {},
    logout: () => {},
    ...overrides,
  };
}

function session(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    session: null,
    isLoading: false,
    hasContext: false,
    error: null,
    refresh: async () => {},
    establish: async () => SESSION,
    endSession: async () => {},
    arrivalAt: null,
    acknowledgeArrival: () => {},
    ...overrides,
  };
}

/** Renders a guard at /private with a recognisable landing page at /login and /scan. */
function renderGuard(
  guard: React.ReactElement,
  authValue: AuthContextValue,
  sessionValue: SessionContextValue,
) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>login screen</p> },
      { path: '/scan', element: <p>scan screen</p> },
      { path: '/private', element: guard, children: [{ index: true, element: <p>protected content</p> }] },
    ],
    { initialEntries: ['/private'] },
  );

  return render(
    <AuthContext.Provider value={authValue}>
      <SessionContext.Provider value={sessionValue}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('RequireAuth', () => {
  it('renders the protected route for a signed-in user', () => {
    renderGuard(<RequireAuth />, auth({ user: USER, isAuthenticated: true }), session());

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('sends an anonymous visitor to the login screen', () => {
    renderGuard(<RequireAuth />, auth(), session());

    expect(screen.getByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('waits rather than redirecting while a stored token is being checked', () => {
    // Redirecting during the check would bounce a legitimately signed-in
    // person to the login screen on every refresh.
    renderGuard(<RequireAuth />, auth({ isRestoring: true }), session());

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });
});

describe('RequireContext', () => {
  it('renders the route once branch context exists', () => {
    renderGuard(
      <RequireContext />,
      auth({ user: USER, isAuthenticated: true }),
      session({ session: SESSION, hasContext: true }),
    );

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('sends a user with no branch context to the scan screen', () => {
    // The assistant must never answer without knowing which branch the
    // customer is in.
    renderGuard(<RequireContext />, auth({ user: USER, isAuthenticated: true }), session());

    expect(screen.getByText('scan screen')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('waits while the active visit is being looked up', () => {
    renderGuard(
      <RequireContext />,
      auth({ user: USER, isAuthenticated: true }),
      session({ isLoading: true }),
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('scan screen')).not.toBeInTheDocument();
  });

  it('explains a failed lookup instead of silently redirecting to scan', () => {
    // A dropped connection is not the same as having no visit. Bouncing
    // the customer to the scan screen would tell them nothing and invite
    // them to redo work they had already done.
    renderGuard(
      <RequireContext />,
      auth({ user: USER, isAuthenticated: true }),
      session({ error: 'Cannot reach the server. Check your connection and try again.' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/cannot reach the server/i);
    expect(screen.getByRole('heading', { name: /could not load your branch/i })).toBeVisible();
    expect(screen.queryByText('scan screen')).not.toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('offers a retry that re-runs the lookup', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);

    renderGuard(
      <RequireContext />,
      auth({ user: USER, isAuthenticated: true }),
      session({ error: 'Cannot reach the server.', refresh }),
    );

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('still offers a way to scan from the error screen', async () => {
    renderGuard(
      <RequireContext />,
      auth({ user: USER, isAuthenticated: true }),
      session({ error: 'Cannot reach the server.' }),
    );

    await userEvent.click(screen.getByRole('button', { name: /scan a code instead/i }));

    expect(await screen.findByText('scan screen')).toBeInTheDocument();
  });
});

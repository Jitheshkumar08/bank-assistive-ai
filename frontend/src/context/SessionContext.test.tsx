import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { SessionProvider } from './SessionContext';
import { useSession } from './useSession';
import { ApiError } from '@/types/api';
import type { Session } from '@/types/session';

const active = vi.fn();
const establish = vi.fn();
const end = vi.fn();

vi.mock('@/api/sessions.api', () => ({
  sessionsApi: {
    active: (...args: unknown[]) => active(...args),
    establish: (...args: unknown[]) => establish(...args),
    end: (...args: unknown[]) => end(...args),
  },
}));

const SESSION: Session = {
  id: 's1',
  status: 'ACTIVE',
  language: 'en',
  startedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  endedAt: null,
  branch: { id: 'b1', code: 'BR001', name: 'Surathkal Branch', city: 'Mangaluru' },
};

const AUTHENTICATED: AuthContextValue = {
  user: { id: 'u1', email: 'demo@bankassist.local', fullName: 'Demo Customer', preferredLanguage: 'en' },
  isAuthenticated: true,
  isRestoring: false,
  login: async () => {},
  register: async () => {},
  updateProfile: async () => {},
  changePassword: async () => {},
  logout: () => {},
};

/** Surfaces the context so assertions can read it out of the DOM. */
function Probe() {
  const { session, isLoading, hasContext, error, refresh } = useSession();

  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="has-context">{String(hasContext)}</p>
      <p data-testid="branch">{session?.branch.name ?? 'none'}</p>
      <p data-testid="error">{error ?? 'none'}</p>
      <button type="button" onClick={() => void refresh()}>
        refresh
      </button>
    </div>
  );
}

function renderProvider(auth: AuthContextValue = AUTHENTICATED) {
  return render(
    <AuthContext.Provider value={auth}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </AuthContext.Provider>,
  );
}

describe('SessionProvider', () => {
  beforeEach(() => {
    active.mockReset();
    establish.mockReset();
    end.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the existing visit on mount and never creates one', async () => {
    active.mockResolvedValue(SESSION);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('branch')).toHaveTextContent('Surathkal Branch'));

    // Requirement: refreshing must not start a second visit. Only a
    // deliberate scan may call establish().
    expect(active).toHaveBeenCalled();
    expect(establish).not.toHaveBeenCalled();
  });

  it('treats "no active visit" as an absence, not a failure', async () => {
    active.mockResolvedValue(null);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    expect(screen.getByTestId('has-context')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('reports a failed lookup as an error rather than an absent visit', async () => {
    active.mockRejectedValue(new ApiError('Cannot reach the server.', 0));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/cannot reach/i));

    // Both leave `session` null, so without the separate error flag the
    // app cannot tell "scan a code" apart from "we could not check".
    expect(screen.getByTestId('has-context')).toHaveTextContent('false');
  });

  it('clears the error when a retry succeeds', async () => {
    active.mockRejectedValueOnce(new ApiError('Cannot reach the server.', 0));

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/cannot reach/i));

    active.mockResolvedValueOnce(SESSION);
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => expect(screen.getByTestId('branch')).toHaveTextContent('Surathkal Branch'));
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('does not look anything up while signed out', async () => {
    renderProvider({ ...AUTHENTICATED, user: null, isAuthenticated: false });

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    expect(active).not.toHaveBeenCalled();
    expect(screen.getByTestId('has-context')).toHaveTextContent('false');
  });
});

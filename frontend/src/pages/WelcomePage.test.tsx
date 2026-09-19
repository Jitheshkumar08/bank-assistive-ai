import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { VoiceContext, type VoiceContextValue } from '@/context/VoiceContext';
import { WelcomePage } from './WelcomePage';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Anita Rao Shetty',
  preferredLanguage: 'en',
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
    user: USER,
    isAuthenticated: true,
    isRestoring: false,
    login: async () => {},
    register: async () => {},
    updateProfile: async () => {},
    changePassword: async () => {},
    logout: () => {},
    ...overrides,
  };
}

function session(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    session: SESSION,
    isLoading: false,
    hasContext: true,
    error: null,
    refresh: async () => {},
    establish: async () => SESSION,
    endSession: async () => {},
    // The default is "just arrived", because that is how this screen is
    // reached: a scan or a typed code, then straight here.
    arrivalAt: 1_000,
    acknowledgeArrival,
    ...overrides,
  };
}

const speak = vi.fn<(text: string) => Promise<void>>();
const acknowledgeArrival = vi.fn();

function voice(overrides: Partial<VoiceContextValue> = {}): VoiceContextValue {
  return {
    preference: 'enabled',
    isEnabled: true,
    needsChoice: false,
    activity: 'idle',
    isBusy: false,
    micStatus: 'idle',
    micMessage: null,
    retryMicrophone: () => {},
    speechError: null,
    lastRecording: null,
    enable: () => {},
    disable: () => {},
    startListening: () => {},
    stopListening: () => {},
    submitUtterance: async () => {},
    startSpeaking: () => {},
    stopSpeaking: () => {},
    speak,
    reset: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  speak.mockReset();
  speak.mockResolvedValue(undefined);
  acknowledgeArrival.mockReset();
  sessionStorage.clear();
});

function routerFor() {
  return createMemoryRouter(
    [
      { path: '/welcome', element: <WelcomePage /> },
      { path: '/assistant', element: <p>assistant screen</p> },
      { path: '/scan', element: <p>scan screen</p> },
    ],
    { initialEntries: ['/welcome'] },
  );
}

/** Re-renders the same screen with a different session value. */
let lastRerender: ReturnType<typeof render>['rerender'] | null = null;

function rerenderWith(
  sessionValue: SessionContextValue,
  rerender = lastRerender,
): void {
  rerender?.(
    <AuthContext.Provider value={auth()}>
      <SessionContext.Provider value={sessionValue}>
        <VoiceContext.Provider value={voice()}>
          <RouterProvider router={routerFor()} />
        </VoiceContext.Provider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );
}

function renderWelcome(
  authValue = auth(),
  sessionValue = session(),
  voiceValue = voice(),
) {
  const router = routerFor();

  const result = render(
    <AuthContext.Provider value={authValue}>
      <SessionContext.Provider value={sessionValue}>
        <VoiceContext.Provider value={voiceValue}>
          <RouterProvider router={router} />
        </VoiceContext.Provider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );

  lastRerender = result.rerender;

  return result;
}

describe('WelcomePage', () => {
  describe('real data', () => {
    it('greets the signed-in customer by their first name', () => {
      renderWelcome();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Anita');
    });

    it('shows the branch from the active visit', () => {
      renderWelcome();

      expect(screen.getByText('Surathkal Branch')).toBeInTheDocument();
      expect(screen.getByText('Mangaluru')).toBeInTheDocument();
    });

    it('reflects a different visit rather than any fixed content', () => {
      // Guards against the page quietly hard-coding a branch that
      // happens to match the seed data.
      renderWelcome(
        auth({ user: { ...USER, fullName: 'Ravi Kumar' } }),
        session({
          session: {
            ...SESSION,
            branch: { id: 'b2', code: 'BR002', name: 'Mangaluru City Branch', city: 'Mangaluru' },
          },
        }),
      );

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Ravi');
      expect(screen.getByText('Mangaluru City Branch')).toBeInTheDocument();
      expect(screen.queryByText('Surathkal Branch')).not.toBeInTheDocument();
    });

  });

    it('omits the optional city when the branch has none', () => {
      renderWelcome(
        auth(),
        session({ session: { ...SESSION, branch: { ...SESSION.branch, city: null } } }),
      );

      expect(screen.getByText('Surathkal Branch')).toBeInTheDocument();
      expect(screen.queryByText('Mangaluru')).not.toBeInTheDocument();
    });

  describe('the spoken welcome', () => {
    it('says hello by name and names the branch', async () => {
      renderWelcome();

      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
      expect(speak.mock.calls[0][0]).toContain('Anita');
      expect(speak.mock.calls[0][0]).toContain('Surathkal Branch');
    });

    it('speaks the language of the visit, not of the browser', async () => {
      renderWelcome(auth(), session({ session: { ...SESSION, language: 'kn' } }));

      await waitFor(() => expect(speak).toHaveBeenCalled());
      // The visit's language chooses the voice server-side, so the words
      // have to match or a Kannada voice reads English aloud.
      expect(speak.mock.calls[0][0]).toMatch(/[ಀ-೿]/);
    });

    it('greets every arrival, including a return to the same branch', async () => {
      const { rerender } = renderWelcome();
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

      // Scanning the same code again -- after changing a setting, say --
      // is a new arrival. Treating it as "already greeted" left the
      // customer checking whether their change worked in silence.
      rerenderWith(session({ arrivalAt: 2_000 }), rerender);

      await waitFor(() => expect(speak).toHaveBeenCalledTimes(2));
    });

    it('fetches the speech once per arrival, however often the effect runs', async () => {
      renderWelcome();
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

      // Re-rendering with the same arrival must not buy the same
      // sentence from the speech service twice. StrictMode runs effects
      // twice on purpose to surface exactly this.
      rerenderWith(session());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(speak).toHaveBeenCalledTimes(1);
    });

    it('says nothing when the screen was reached without arriving', async () => {
      // Walking back from the assistant, or reloading onto an existing
      // visit. Neither is an arrival.
      renderWelcome(auth(), session({ arrivalAt: null }));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(speak).not.toHaveBeenCalled();
    });

    it('consumes the arrival so it cannot be greeted twice', async () => {
      renderWelcome();

      await waitFor(() => expect(acknowledgeArrival).toHaveBeenCalledTimes(1));
    });

    it('consumes the arrival even with voice off', async () => {
      renderWelcome(auth(), session(), voice({ isEnabled: false, preference: 'disabled' }));

      // Otherwise turning voice on later in the visit would suddenly
      // announce an arrival that happened minutes ago.
      await waitFor(() => expect(acknowledgeArrival).toHaveBeenCalledTimes(1));
      expect(speak).not.toHaveBeenCalled();
    });

    it('stays silent when the customer has not opted into speech', async () => {
      renderWelcome(auth(), session(), voice({ isEnabled: false, preference: 'disabled' }));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(speak).not.toHaveBeenCalled();
    });

    it('stays silent while the customer has not been asked yet', async () => {
      renderWelcome(auth(), session(), voice({ isEnabled: false, preference: 'unset' }));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(speak).not.toHaveBeenCalled();
    });

    it('offers a way to hear it again', async () => {
      renderWelcome();
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

      // The way back from a browser that refused to autoplay.
      await userEvent.click(screen.getByRole('button', { name: /hear this again/i }));

      expect(speak).toHaveBeenCalledTimes(2);
    });

    it('hides the replay control when speech is off', () => {
      renderWelcome(auth(), session(), voice({ isEnabled: false, preference: 'disabled' }));

      expect(screen.queryByRole('button', { name: /hear this again/i })).not.toBeInTheDocument();
    });

    it('leaves the written welcome intact when speech fails', async () => {
      speak.mockRejectedValue(new Error('no audio device'));

      renderWelcome();

      await waitFor(() => expect(speak).toHaveBeenCalled());
      // The screen is the reply; the voice is an enhancement on top of
      // it, and losing it must cost nothing.
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Anita');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('continues to the assistant', async () => {
      renderWelcome();

      await userEvent.click(screen.getByRole('link', { name: /continue to assistant/i }));

      expect(await screen.findByText('assistant screen')).toBeInTheDocument();
    });

    it('starts a common request in one tap', async () => {
      renderWelcome();

      const deposit = screen.getByRole('link', { name: /deposit money/i });
      expect(deposit).toHaveAttribute('href', '/assistant');

      await userEvent.click(deposit);

      expect(await screen.findByText('assistant screen')).toBeInTheDocument();
    });

    it('offers a way back to scanning without signing out', async () => {
      const logout = vi.fn();
      renderWelcome(auth({ logout }), session());

      await userEvent.click(screen.getByRole('link', { name: /change location/i }));

      expect(await screen.findByText('scan screen')).toBeInTheDocument();
      // Changing counter is not leaving the bank.
      expect(logout).not.toHaveBeenCalled();
    });

    it('uses links, not buttons, so navigation keeps browser behaviour', () => {
      renderWelcome();

      expect(screen.getByRole('link', { name: /continue to assistant/i })).toHaveAttribute(
        'href',
        '/assistant',
      );
      expect(screen.getByRole('link', { name: /change location/i })).toHaveAttribute(
        'href',
        '/scan',
      );
    });
  });

  describe('defensive behaviour', () => {
    it('sends the customer to scan rather than rendering blanks with no visit', () => {
      renderWelcome(auth(), session({ session: null, hasContext: false }));

      expect(screen.getByText('scan screen')).toBeInTheDocument();
    });

    it('sends the customer to scan when there is no signed-in user', () => {
      renderWelcome(auth({ user: null, isAuthenticated: false }), session());

      expect(screen.getByText('scan screen')).toBeInTheDocument();
    });
  });
});

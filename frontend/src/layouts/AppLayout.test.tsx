import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { ConversationContext, type ConversationState } from '@/context/ConversationContext';
import { VoiceProvider } from '@/context/VoiceContext';
import { useConversation } from '@/context/useConversation';
import { AppLayout } from './AppLayout';
import { AuthLayout } from './AuthLayout';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';
import { fakeMicrophoneControls } from '@/test/fakeMicrophone';

vi.mock('@/hooks/useMicrophone', async () => ({
  useMicrophone: (await import('@/test/fakeMicrophone')).fakeUseMicrophone,
}));

const send = vi.fn();
const sendVoice = vi.fn();

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Demo Customer',
  preferredLanguage: 'en',
  role: 'CUSTOMER',
  suggestionsEnabled: true,
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

const auth: AuthContextValue = {
  user: USER,
  isAuthenticated: true,
  isRestoring: false,
  login: async () => USER,
  register: async () => {},
  updateProfile: async () => {},
  changePassword: async () => {},
  logout: () => {},
};

const session: SessionContextValue = {
  session: SESSION,
  isLoading: false,
  hasContext: true,
  error: null,
  refresh: async () => {},
  establish: async () => SESSION,
  endSession: async () => {},
  arrivalAt: null,
  acknowledgeArrival: () => {},
};

const conversation: ConversationState = {
  messages: [],
  isSending: false,
  error: null,
  isEmpty: true,
  canRetry: false,
  workflow: null,
  ended: false,
  send: (...args) => send(...args),
  sendVoice: (...args) => sendVoice(...args),
  retry: async () => {},
  subscribeToReplies: () => () => {},
};

/** Speaks into the conversation from a screen that is not the assistant. */
function ConversationProbe() {
  const { send: sendMessage } = useConversation();

  return (
    <button type="button" onClick={() => void sendMessage('spoken from the scan screen')}>
      probe send
    </button>
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: '/scan', element: <ConversationProbe /> },
          { path: '/welcome', element: <p>welcome screen</p> },
          { path: '/assistant', element: <p>assistant screen</p> },
          { path: '/chat', element: <p>chat screen</p>, handle: { chat: true } },
        ],
      },
      {
        element: <AuthLayout />,
        children: [{ path: '/login', element: <p>login screen</p> }],
      },
    ],
    { initialEntries: [path] },
  );

  return render(
    <AuthContext.Provider value={auth}>
      <SessionContext.Provider value={session}>
        <ConversationContext.Provider value={conversation}>
          <VoiceProvider>
            <RouterProvider router={router} />
          </VoiceProvider>
        </ConversationContext.Provider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );
}

const optInHeading = () => screen.queryByRole('heading', { name: /would you like voice assistance/i });

describe('AppLayout voice integration', () => {
  beforeEach(() => {
    sessionStorage.clear();
    fakeMicrophoneControls.reset();
    send.mockReset().mockResolvedValue(undefined);
  });

  describe('the first-time prompt', () => {
    it('asks once, before any preference exists', () => {
      renderAt('/scan');

      expect(optInHeading()).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /enable voice/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /continue with text/i })).toBeInTheDocument();
    });

    it('is a modal, so the question is answered before anything else', () => {
      renderAt('/scan');

      // It used to be an inline card, to avoid trapping focus in front
      // of a live viewfinder. It is a dialog now, and the scan screen
      // holds the camera closed until the question is answered -- so
      // there is no viewfinder behind it to trap focus over.
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('stops asking once voice is enabled', async () => {
      renderAt('/scan');

      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));

      expect(optInHeading()).not.toBeInTheDocument();
    });

    it('stops asking once text is chosen', async () => {
      renderAt('/scan');

      await userEvent.click(screen.getByRole('button', { name: /continue with text/i }));

      expect(optInHeading()).not.toBeInTheDocument();
    });

    it('does not ask again on a later screen in the same session', async () => {
      const first = renderAt('/scan');
      await userEvent.click(screen.getByRole('button', { name: /continue with text/i }));
      first.unmount();

      renderAt('/welcome');

      expect(optInHeading()).not.toBeInTheDocument();
    });
  });

  describe('the microphone control', () => {
    it.each(['/scan', '/welcome', '/assistant'])('is available on %s once voice is on', async (path) => {
      renderAt(path);
      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));

      expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument();
    });

    it('stays out of the way while voice is off', async () => {
      renderAt('/scan');
      await userEvent.click(screen.getByRole('button', { name: /continue with text/i }));

      // A microphone for someone who chose text would be a control that
      // does nothing. Voice comes back from the account menu instead.
      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
    });

    it('is absent before the customer has been asked', () => {
      renderAt('/scan');

      // The opt-in dialog is the affordance at that point; two prompts
      // competing for the same decision is noise.
      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
    });

    it('never appears on the signed-out layout', () => {
      renderAt('/login');

      expect(screen.getByText('login screen')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
      expect(optInHeading()).not.toBeInTheDocument();
    });

    it('turns voice on and off from the account menu', async () => {
      renderAt('/welcome');
      await userEvent.click(screen.getByRole('button', { name: /continue with text/i }));

      await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
      const voiceSwitch = screen.getByRole('switch', { name: /voice assistance/i });
      expect(voiceSwitch).toHaveAttribute('aria-checked', 'false');

      await userEvent.click(voiceSwitch);
      expect(voiceSwitch).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument();

      await userEvent.click(voiceSwitch);
      expect(voiceSwitch).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
    });

    it('moves to listening only when pressed, never on enabling', async () => {
      renderAt('/assistant');
      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));

      // Enabling alone must not start a turn.
      expect(screen.queryByText('Listening')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /start voice input/i }));

      expect(screen.getByRole('button', { name: /stop listening/i })).toBeInTheDocument();
      expect(screen.getAllByText('Listening').length).toBeGreaterThan(0);
    });

    it('returns to rest when the listening button is pressed again', async () => {
      renderAt('/assistant');
      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));
      await userEvent.click(screen.getByRole('button', { name: /start voice input/i }));

      await userEvent.click(screen.getByRole('button', { name: /stop listening/i }));

      expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument();
    });

    it('keeps the announcement out of page flow', async () => {
      renderAt('/assistant');
      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));

      const live = screen.getByRole('status');
      // sr-only, and inside the fixed overlay, so it can never reflow the
      // page the way an in-flow live region would.
      expect(live).toHaveClass('sr-only');
      expect(live).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('when the microphone is refused', () => {
    async function enableVoiceThenPressMic() {
      renderAt('/assistant');
      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));
      await userEvent.click(screen.getByRole('button', { name: /start voice input/i }));
    }

    it('explains the refusal and offers a retry', async () => {
      fakeMicrophoneControls.failWith = {
        status: 'denied',
        message: 'Microphone access is blocked. Allow the microphone, or carry on typing.',
      };

      await enableVoiceThenPressMic();

      expect(await screen.findByRole('alert')).toHaveTextContent(/blocked/i);
      expect(screen.getByRole('button', { name: /try the microphone again/i })).toBeInTheDocument();
    });

    it('does not claim to be listening when nothing is recording', async () => {
      fakeMicrophoneControls.failWith = { status: 'denied', message: 'Microphone access is blocked.' };

      await enableVoiceThenPressMic();

      // The state must follow the browser, not the button press.
      expect(screen.queryByRole('button', { name: /stop listening/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument();
    });

    it('offers no retry when the device simply has no microphone', async () => {
      fakeMicrophoneControls.failWith = {
        status: 'unavailable',
        message: 'No microphone was found on this device.',
      };

      await enableVoiceThenPressMic();

      await screen.findByRole('alert');
      // Retrying cannot conjure hardware into existence.
      expect(
        screen.queryByRole('button', { name: /try the microphone again/i }),
      ).not.toBeInTheDocument();
    });

    it('leaves voice switchable off from the account menu', async () => {
      fakeMicrophoneControls.failWith = { status: 'denied', message: 'Microphone access is blocked.' };

      await enableVoiceThenPressMic();
      await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
      await userEvent.click(screen.getByRole('switch', { name: /voice assistance/i }));

      // Refused or not, the customer can still settle on text.
      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('recording', () => {
    it('finishes a recording when the customer stops it', async () => {
      renderAt('/assistant');
      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));
      await userEvent.click(screen.getByRole('button', { name: /start voice input/i }));

      await userEvent.click(screen.getByRole('button', { name: /stop listening/i }));

      expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument();
      // Phase 10 stops at the Blob: nothing is sent to the assistant.
      expect(send).not.toHaveBeenCalled();
    });

    it('discards the recording when voice is switched off mid-sentence', async () => {
      renderAt('/assistant');
      await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));
      await userEvent.click(screen.getByRole('button', { name: /start voice input/i }));

      await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
      await userEvent.click(screen.getByRole('switch', { name: /voice assistance/i }));

      expect(screen.queryByRole('button', { name: /stop listening/i })).not.toBeInTheDocument();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('one conversation, reachable everywhere', () => {
    it('is available from a screen that is not the assistant', async () => {
      renderAt('/scan');

      await userEvent.click(screen.getByRole('button', { name: /probe send/i }));

      // The scan screen reaches the same send() the assistant page uses.
      await waitFor(() => expect(send).toHaveBeenCalledWith('spoken from the scan screen'));
    });
  });
});

describe('AppLayout header', () => {
  beforeEach(() => {
    sessionStorage.clear();
    fakeMicrophoneControls.reset();
  });

  /** Answers the voice question, which otherwise covers the screen. */
  async function renderWelcomeWithVoiceAnswered() {
    renderAt('/welcome');
    await userEvent.click(screen.getByRole('button', { name: /continue with text/i }));
  }

  const accountButton = () => screen.getByRole('button', { name: /account menu for demo customer/i });

  it('shows which branch the customer is in', () => {
    renderAt('/welcome');

    expect(screen.getByRole('banner')).toHaveTextContent('Surathkal Branch');
    expect(screen.getByRole('banner')).toHaveTextContent('Mangaluru');
  });

  it('keeps the account controls closed until the account button is pressed', async () => {
    await renderWelcomeWithVoiceAnswered();

    expect(accountButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();

    await userEvent.click(accountButton());

    expect(accountButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('demo@bankassist.local')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('closes on Escape and hands focus back to the account button', async () => {
    await renderWelcomeWithVoiceAnswered();
    await userEvent.click(accountButton());

    await userEvent.keyboard('{Escape}');

    expect(accountButton()).toHaveAttribute('aria-expanded', 'false');
    expect(accountButton()).toHaveFocus();
  });

  it('closes when the customer clicks anywhere else', async () => {
    await renderWelcomeWithVoiceAnswered();
    await userEvent.click(accountButton());

    await userEvent.click(screen.getByText('welcome screen'));

    expect(accountButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('signs out from the menu', async () => {
    await renderWelcomeWithVoiceAnswered();
    await userEvent.click(accountButton());

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });
});

describe('AppLayout on a conversation screen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    fakeMicrophoneControls.reset();
  });

  it('leaves the microphone to the composer rather than floating one over it', async () => {
    renderAt('/chat');
    await userEvent.click(screen.getByRole('button', { name: /enable voice/i }));

    expect(screen.getByText('chat screen')).toBeInTheDocument();
    // Two microphones on one screen, one covering the other's composer,
    // was the problem this layout option exists to solve.
    expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
  });
});

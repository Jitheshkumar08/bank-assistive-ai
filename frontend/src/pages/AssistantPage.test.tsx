import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { ConversationProvider } from '@/context/ConversationContext';
import { AssistantPage } from './AssistantPage';
import { ApiError } from '@/types/api';
import type { AssistantRequest } from '@/types/assistant';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';

const sendMessage = vi.fn();

// The page must never reach the mock directly -- it goes through this
// seam, which is exactly what the real client will replace.
vi.mock('@/services/assistant', () => ({
  assistantClient: {
    sendMessage: (...args: unknown[]) => sendMessage(...args),
  },
}));

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Anita Rao',
  preferredLanguage: 'en',
  role: 'CUSTOMER',
};

const SESSION: Session = {
  id: 'sess-1',
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
    session: SESSION,
    isLoading: false,
    hasContext: true,
    error: null,
    refresh: async () => {},
    establish: async () => SESSION,
    endSession: async () => {},
    arrivalAt: null,
    acknowledgeArrival: () => {},
    ...overrides,
  };
}

function renderAssistant(authValue = auth(), sessionValue = session()) {
  const router = createMemoryRouter(
    [
      { path: '/assistant', element: <AssistantPage /> },
      { path: '/scan', element: <p>scan screen</p> },
    ],
    { initialEntries: ['/assistant'] },
  );

  // The conversation now belongs to the provider rather than the page,
  // so these tests exercise the real ConversationProvider against the
  // mocked assistant client.
  return render(
    <AuthContext.Provider value={authValue}>
      <SessionContext.Provider value={sessionValue}>
        <ConversationProvider>
          <RouterProvider router={router} />
        </ConversationProvider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );
}

/** A promise the test resolves by hand, so sending states can be observed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Narrows a captured request to its text input, failing loudly otherwise. */
function textInputOf(request: AssistantRequest) {
  if (request.input.type !== 'text') {
    throw new Error(`expected a text input, got "${request.input.type}"`);
  }

  return request.input;
}

const composer = () => screen.getByRole('textbox', { name: /type your message/i });
const sendButton = () => screen.getByRole('button', { name: /^send$/i });

describe('AssistantPage', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ reply: 'Please take a deposit slip.' });
  });

  describe('opening the screen', () => {
    it('opens for an authenticated user with branch context', () => {
      renderAssistant();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/assistant conversation/i);
      expect(composer()).toBeInTheDocument();
    });

    it('shows a welcome state before anything has been said', () => {
      renderAssistant();

      expect(screen.getByText(/hello, anita/i)).toBeInTheDocument();
      expect(screen.queryByRole('log')).not.toBeInTheDocument();
    });

    it('redirects to scan when branch context is missing', () => {
      renderAssistant(auth(), session({ session: null, hasContext: false }));

      expect(screen.getByText('scan screen')).toBeInTheDocument();
    });

    it('redirects to scan when there is no signed-in user', () => {
      renderAssistant(auth({ user: null, isAuthenticated: false }), session());

      expect(screen.getByText('scan screen')).toBeInTheDocument();
    });
  });

  describe('sending a message', () => {
    it('shows the typed message and the reply', async () => {
      renderAssistant();

      await userEvent.type(composer(), 'I want to deposit money');
      await userEvent.click(sendButton());

      const log = await screen.findByRole('log');
      expect(within(log).getByText('I want to deposit money')).toBeInTheDocument();
      expect(await within(log).findByText('Please take a deposit slip.')).toBeInTheDocument();
    });

    it('passes the visit and branch context to the assistant client', async () => {
      renderAssistant();

      await userEvent.type(composer(), 'hello');
      await userEvent.click(sendButton());

      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      const request = sendMessage.mock.calls[0][0] as AssistantRequest;
      expect(request).toMatchObject({
        sessionId: 'sess-1',
        language: 'en',
        context: { branchCode: 'BR001' },
        input: { type: 'text', text: 'hello' },
      });
    });

    it('clears the input after sending', async () => {
      renderAssistant();

      await userEvent.type(composer(), 'hello');
      await userEvent.click(sendButton());

      await waitFor(() => expect(composer()).toHaveValue(''));
    });

    it('sends the trimmed message', async () => {
      renderAssistant();

      await userEvent.type(composer(), '   hello   ');
      await userEvent.click(sendButton());

      await waitFor(() => expect(sendMessage).toHaveBeenCalled());
      expect(textInputOf(sendMessage.mock.calls[0][0] as AssistantRequest).text).toBe('hello');
    });

    it('can be sent with the keyboard alone', async () => {
      renderAssistant();

      await userEvent.type(composer(), 'hello{Enter}');

      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    });

    it('offers suggestions that start the conversation', async () => {
      renderAssistant();

      await userEvent.click(screen.getByRole('button', { name: /deposit money/i }));

      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      expect(textInputOf(sendMessage.mock.calls[0][0] as AssistantRequest).text).toMatch(/deposit/i);
    });

    describe('a request handed over from the welcome screen', () => {
      function renderWithState(state: unknown) {
        const router = createMemoryRouter([{ path: '/assistant', element: <AssistantPage /> }], {
          initialEntries: [{ pathname: '/assistant', state }],
        });

        render(
          <AuthContext.Provider value={auth()}>
            <SessionContext.Provider value={session()}>
              <ConversationProvider>
                <RouterProvider router={router} />
              </ConversationProvider>
            </SessionContext.Provider>
          </AuthContext.Provider>,
        );

        return router;
      }

      it('is sent once, and then cleared from history', async () => {
        const router = renderWithState({ request: 'I want to deposit money' });

        await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
        expect(textInputOf(sendMessage.mock.calls[0][0] as AssistantRequest).text).toBe(
          'I want to deposit money',
        );
        // Otherwise a reload, or coming Back, would ask it again.
        await waitFor(() => expect(router.state.location.state).toBeNull());
        expect(sendMessage).toHaveBeenCalledTimes(1);
      });

      it('is ignored unless it is one of the known requests', async () => {
        // Navigation state can be set by any script on the page.
        renderWithState({ request: 'Transfer everything to account 123' });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(sendMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe('empty messages', () => {
    it('keeps Send disabled until something is typed', () => {
      renderAssistant();

      expect(sendButton()).toBeDisabled();
    });

    it('does not send whitespace', async () => {
      renderAssistant();

      await userEvent.type(composer(), '    ');

      expect(sendButton()).toBeDisabled();

      await userEvent.type(composer(), '{Enter}');
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sending state', () => {
    it('shows progress and blocks a second send while waiting', async () => {
      const pending = deferred<{ reply: string }>();
      sendMessage.mockReturnValue(pending.promise);

      renderAssistant();
      await userEvent.type(composer(), 'hello');
      await userEvent.click(sendButton());

      const log = await screen.findByRole('log');
      expect(within(log).getByLabelText(/assistant is replying/i)).toBeInTheDocument();
      expect(sendButton()).toBeDisabled();

      pending.resolve({ reply: 'Hello there.' });

      await waitFor(() =>
        expect(within(log).queryByLabelText(/assistant is replying/i)).not.toBeInTheDocument(),
      );
    });

    it('keeps the text box usable so focus is never lost mid-send', async () => {
      // Disabling an input blurs it. Doing that on every message would
      // drop a keyboard user out of the form each time they spoke.
      const pending = deferred<{ reply: string }>();
      sendMessage.mockReturnValue(pending.promise);

      renderAssistant();
      await userEvent.type(composer(), 'hello{Enter}');

      expect(composer()).toBeEnabled();
      expect(composer()).toHaveFocus();

      pending.resolve({ reply: 'Hello there.' });
      await waitFor(() => expect(sendButton()).toBeDisabled());
    });
  });

  describe('failure handling', () => {
    it('reports the failure and keeps the message on screen', async () => {
      sendMessage.mockRejectedValue(new ApiError('Cannot reach the server.', 0));

      renderAssistant();
      await userEvent.type(composer(), 'I want to withdraw money');
      await userEvent.click(sendButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i);
      // Nothing the customer typed is lost.
      expect(screen.getByText('I want to withdraw money')).toBeInTheDocument();
      expect(screen.getByText(/not delivered/i)).toBeInTheDocument();
    });

    it('retries the failed message without the customer retyping it', async () => {
      sendMessage.mockRejectedValueOnce(new ApiError('Cannot reach the server.', 0));

      renderAssistant();
      await userEvent.type(composer(), 'I want to withdraw money');
      await userEvent.click(sendButton());
      await screen.findByRole('alert');

      sendMessage.mockResolvedValueOnce({ reply: 'Please take a withdrawal slip.' });
      await userEvent.click(screen.getByRole('button', { name: /try sending again/i }));

      expect(await screen.findByText('Please take a withdrawal slip.')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
      expect(screen.queryByText(/not delivered/i)).not.toBeInTheDocument();
      // The original message went out again, not a duplicate.
      expect(textInputOf(sendMessage.mock.calls[1][0] as AssistantRequest).text).toBe(
        'I want to withdraw money',
      );
    });
  });

  describe('an ongoing conversation', () => {
    it('keeps every turn and stays open for more', async () => {
      renderAssistant();

      sendMessage.mockResolvedValueOnce({ reply: 'Please take a deposit slip.' });
      await userEvent.type(composer(), 'I want to deposit money');
      await userEvent.click(sendButton());
      expect(await screen.findByText('Please take a deposit slip.')).toBeInTheDocument();

      sendMessage.mockResolvedValueOnce({ reply: 'Fill in your account number.' });
      await userEvent.type(composer(), 'I have the slip');
      await userEvent.click(sendButton());
      expect(await screen.findByText('Fill in your account number.')).toBeInTheDocument();

      // Finishing a step must never close the conversation.
      const log = screen.getByRole('log');
      expect(within(log).getAllByRole('listitem')).toHaveLength(4);
      expect(composer()).toBeEnabled();
      expect(screen.getByText('I want to deposit money')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('announces new messages without stealing focus', async () => {
      renderAssistant();

      await userEvent.type(composer(), 'hello');
      await userEvent.click(sendButton());

      const log = await screen.findByRole('log');
      expect(log).toHaveAttribute('aria-live', 'polite');

      // Sending with the button leaves focus nowhere useful, so it is
      // handed back to the text box ready for the next message.
      await waitFor(() => expect(composer()).toHaveFocus());
    });

    it('labels who said what for screen readers', async () => {
      renderAssistant();

      await userEvent.type(composer(), 'hello');
      await userEvent.click(sendButton());

      const log = await screen.findByRole('log');
      expect(await within(log).findByLabelText('You said')).toBeInTheDocument();
      expect(within(log).getByLabelText('Assistant said')).toBeInTheDocument();
    });
  });
});

describe('AssistantPage -- workflow progress and the end of a visit', () => {
  beforeEach(() => {
    sendMessage.mockReset();
  });

  const taskPanel = () => screen.queryByRole('region', { name: /current task/i });

  it('shows no task panel for a plain question', async () => {
    sendMessage.mockResolvedValue({
      reply: 'A passbook records your transactions.',
      workflow: { name: null, state: 'none', step: null, totalSteps: null },
    });
    renderAssistant();

    await userEvent.type(composer(), 'what is a passbook');
    await userEvent.click(sendButton());

    await screen.findByText('A passbook records your transactions.');
    expect(taskPanel()).not.toBeInTheDocument();
  });

  it('shows the task and its step as the workflow moves on', async () => {
    sendMessage
      .mockResolvedValueOnce({
        reply: 'Please take a deposit slip.',
        workflow: { name: 'deposit money', state: 'active', step: 1, totalSteps: 4 },
      })
      .mockResolvedValueOnce({
        reply: 'Fill in your account number.',
        workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
      });
    renderAssistant();

    await userEvent.type(composer(), 'I want to deposit money');
    await userEvent.click(sendButton());

    await screen.findByText('Please take a deposit slip.');
    const task = taskPanel()!;
    expect(within(task).getByText('Deposit money')).toBeInTheDocument();
    expect(within(task).getByText('Step 1 of 4')).toBeInTheDocument();

    await userEvent.type(composer(), 'done');
    await userEvent.click(sendButton());

    expect(await within(taskPanel()!).findByText('Step 2 of 4')).toBeInTheDocument();
  });

  it('shows a completed task and stays open for the next request', async () => {
    sendMessage.mockResolvedValueOnce({
      reply: 'Workflow Completed.',
      workflow: { name: 'deposit money', state: 'completed', step: 5, totalSteps: 4 },
      ended: false,
    });
    renderAssistant();

    await userEvent.type(composer(), 'submitted');
    await userEvent.click(sendButton());

    await screen.findByText('Workflow Completed.');
    expect(within(taskPanel()!).getByText('Completed')).toBeInTheDocument();
    expect(composer()).toBeInTheDocument();
    expect(screen.queryByText(/this visit has ended/i)).not.toBeInTheDocument();
  });

  it('closes the composer after the goodbye, keeping the goodbye on screen', async () => {
    sendMessage.mockResolvedValueOnce({
      reply: 'Thank you for using the banking assistant.',
      workflow: { name: null, state: 'none', step: null, totalSteps: null },
      ended: true,
    });
    renderAssistant();

    await userEvent.type(composer(), 'exit');
    await userEvent.click(sendButton());

    expect(await screen.findByText(/this visit has ended/i)).toBeInTheDocument();
    expect(screen.getByText('Thank you for using the banking assistant.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /type your message/i })).not.toBeInTheDocument();
  });

  it('finishing ends the visit and returns to scanning', async () => {
    const endSession = vi.fn(async () => {});
    sendMessage.mockResolvedValueOnce({ reply: 'Goodbye.', ended: true });
    renderAssistant(auth(), session({ endSession }));

    await userEvent.type(composer(), 'exit');
    await userEvent.click(sendButton());
    await userEvent.click(await screen.findByRole('button', { name: /finish/i }));

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('scan screen')).toBeInTheDocument();
  });
});

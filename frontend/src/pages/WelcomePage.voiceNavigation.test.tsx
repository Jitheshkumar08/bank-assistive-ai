import { act, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { ConversationProvider } from '@/context/ConversationContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { useConversation } from '@/context/useConversation';
import { VoiceContext } from '@/context/VoiceContext';
import { fakeVoice } from '@/test/fakeVoice';
import type { AssistantReply, AssistantRequest } from '@/types/assistant';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';
import { AssistantPage } from './AssistantPage';
import { WelcomePage } from './WelcomePage';

/**
 * A spoken request on the welcome screen, end to end in the browser layer.
 *
 * Real: WelcomePage, AssistantPage, ConversationProvider and the router.
 * Stand-ins: the assistant client, answering with the reply shape the
 * engine actually sends -- workflow names are the engine's intent labels
 * ("deposit money"), not the workflow file names -- and a scripted voice
 * context. No server, microphone, speaker or LLM.
 */

const sendMessage = vi.fn<(request: AssistantRequest) => Promise<AssistantReply>>();

vi.mock('@/services/assistant', () => ({
  assistantClient: {
    sendMessage: (request: AssistantRequest) => sendMessage(request),
    requestAssistance: vi.fn(async () => ({ offered: false })),
    speak: vi.fn(),
  },
}));

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Anita Rao',
  preferredLanguage: 'en',
  role: 'CUSTOMER',
};

function sessionFor(language: string): Session {
  return {
    id: 'sess-1',
    status: 'ACTIVE',
    language,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    endedAt: null,
    branch: { id: 'b1', code: 'BR001', name: 'Surathkal Branch', city: 'Mangaluru' },
  };
}

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

function sessionValue(language: string): SessionContextValue {
  const session = sessionFor(language);
  return {
    session,
    isLoading: false,
    hasContext: true,
    error: null,
    refresh: async () => {},
    establish: async () => session,
    endSession: async () => {},
    arrivalAt: null,
    acknowledgeArrival: () => {},
  };
}

/** Gives the test the conversation's sendVoice, as VoiceProvider uses it. */
let speakIntoConversation: (() => Promise<string | null>) | null = null;

function VoiceTurn() {
  const { sendVoice } = useConversation();
  speakIntoConversation = () => sendVoice(new Blob([new Uint8Array(64)]), 'audio/webm');
  return null;
}

function renderApp(language = 'en') {
  const router = createMemoryRouter(
    [
      { path: '/welcome', element: <WelcomePage /> },
      { path: '/assistant', element: <AssistantPage /> },
    ],
    { initialEntries: ['/welcome'] },
  );

  render(
    <AuthContext.Provider value={auth}>
      <SessionContext.Provider value={sessionValue(language)}>
        <ConversationProvider>
          <VoiceContext.Provider value={fakeVoice()}>
            <VoiceTurn />
            <RouterProvider router={router} />
          </VoiceContext.Provider>
        </ConversationProvider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );

  return router;
}

async function speak(reply: AssistantReply): Promise<void> {
  sendMessage.mockResolvedValueOnce(reply);
  await act(async () => {
    await speakIntoConversation!();
  });
}

const started = (name: string, transcript: string, reply: string): AssistantReply => ({
  reply,
  transcript,
  workflow: { name, state: 'active', step: 1, totalSteps: 4 },
});

beforeEach(() => {
  sendMessage.mockReset();
  speakIntoConversation = null;
  sessionStorage.clear();
});

describe('a spoken request on the welcome screen', () => {
  it.each([
    ['deposit money', 'I want to deposit money', 'Please take a deposit slip.', 'Deposit money'],
    ['withdraw money', 'I want to withdraw money', 'Please take a withdrawal slip.', 'Withdraw money'],
    ['apply for loan', 'I want to apply for a loan', 'Please fill in the loan form.', 'Apply for loan'],
  ])(
    'that starts "%s" opens the assistant on that workflow, without sending it again',
    async (name, transcript, reply, task) => {
      const router = renderApp();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Anita');

      await speak(started(name, transcript, reply));

      expect(router.state.location.pathname).toBe('/assistant');
      // The conversation carried over: the customer's words, the step,
      // and the workflow's progress.
      expect((await screen.findAllByText(transcript)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(reply).length).toBeGreaterThan(0);
      // WorkflowProgress names the task the engine reported.
      expect(screen.getByText(task)).toBeInTheDocument();
      // One turn reached the assistant. Arriving did not send another.
      expect(sendMessage).toHaveBeenCalledTimes(1);
    },
  );

  it('carries the visit, branch and language with the spoken turn', async () => {
    const router = renderApp('kn');

    await speak(started('deposit money', 'ಡೆಪಾಸಿಟ್', 'ಡೆಪಾಸಿಟ್ ಸ್ಲಿಪ್ ತೆಗೆದುಕೊಳ್ಳಿ.'));

    expect(router.state.location.pathname).toBe('/assistant');
    const request = sendMessage.mock.calls[0][0];
    expect(request.sessionId).toBe('sess-1');
    expect(request.language).toBe('kn');
    expect(request.context).toEqual({ branchCode: 'BR001' });
    expect(request.input.type).toBe('voice');
  });

  it('stays on the welcome screen when the assistant asks which service was meant', async () => {
    const router = renderApp();

    await speak({
      reply: 'Would you like to deposit or withdraw money?',
      transcript: 'I need money',
      workflow: { name: null, state: 'none', step: null, totalSteps: null },
    });

    expect(router.state.location.pathname).toBe('/welcome');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Anita');
  });

  it('stays on the welcome screen for a general question', async () => {
    const router = renderApp();

    await speak({ reply: 'We are open from ten until four.', transcript: 'When do you open?' });

    expect(router.state.location.pathname).toBe('/welcome');
  });

  it('opens the assistant once for a turn, and the next turn is sent normally', async () => {
    const router = renderApp();
    const navigate = vi.spyOn(router, 'navigate');

    await speak(started('deposit money', 'I want to deposit money', 'Please take a deposit slip.'));
    expect(navigate).toHaveBeenCalledTimes(1);

    await speak({
      reply: 'Now fill in your account number.',
      transcript: 'done',
      workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/assistant');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});

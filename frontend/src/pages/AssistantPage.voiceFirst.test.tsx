import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { ConversationProvider } from '@/context/ConversationContext';
import { VoiceContext, type VoiceContextValue } from '@/context/VoiceContext';
import { fakeVoice } from '@/test/fakeVoice';
import type { AssistanceOffer, AssistantReply, AssistantRequest } from '@/types/assistant';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';
import { AssistantPage } from './AssistantPage';

/**
 * The voice-first assistant screen and proactive help, end to end in the
 * browser layer.
 *
 * Real: AssistantPage, ConversationProvider, useProactiveAssistance and the
 * components. Stand-ins: the assistant client (no server, no LLM, no TTS),
 * and the voice context (scripted; no microphone or speaker). The quiet
 * threshold is shortened here so real timers can be used; the 12-second
 * default itself is tested with fake timers in the hook's own suite.
 */

vi.mock('@/lib/assistanceConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assistanceConfig')>()),
  ASSISTANCE_INACTIVITY_MS: 60,
}));

const sendMessage = vi.fn();
const requestAssistance = vi.fn();

vi.mock('@/services/assistant', () => ({
  assistantClient: {
    sendMessage: (...args: unknown[]) => sendMessage(...args),
    requestAssistance: (...args: unknown[]) => requestAssistance(...args),
    speak: vi.fn(),
  },
}));

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Anita Rao',
  preferredLanguage: 'en',
  role: 'CUSTOMER',
  suggestionsEnabled: true,
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

function sessionValue(language = 'en'): SessionContextValue {
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

function page(voice: VoiceContextValue | null, language = 'en') {
  const router = createMemoryRouter([{ path: '/assistant', element: <AssistantPage /> }], {
    initialEntries: ['/assistant'],
  });
  const tree = (value: VoiceContextValue | null) => (
    <AuthContext.Provider value={auth}>
      <SessionContext.Provider value={sessionValue(language)}>
        <ConversationProvider>
          <VoiceContext.Provider value={value}>
            <RouterProvider router={router} />
          </VoiceContext.Provider>
        </ConversationProvider>
      </SessionContext.Provider>
    </AuthContext.Provider>
  );
  const view = render(tree(voice));
  return { ...view, setVoice: (value: VoiceContextValue | null) => view.rerender(tree(value)) };
}

const DEPOSIT_STEP_2: AssistantReply = {
  reply: 'Fill in your account number. Let me know when you have completed it.',
  workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
};

const OFFER: AssistanceOffer = {
  offered: true,
  reason: 'offered',
  field: 'account_number',
  promptId: 'account_number.1',
  text: 'Take your time. Are you having difficulty entering the account number? I can help if you need me. Just say help.',
};

const textOf = (request: AssistantRequest) =>
  request.input.type === 'text' ? request.input.text : `<${request.input.type}>`;

async function reachAccountStep() {
  sendMessage.mockResolvedValueOnce(DEPOSIT_STEP_2);
  await userEvent.type(screen.getByRole('textbox', { name: /type your message/i }), 'deposit{Enter}');
  await waitFor(() =>
    expect(within(screen.getByRole('region', { name: /current task/i })).getByText('Step 2 of 4'))
      .toBeInTheDocument(),
  );
}

beforeEach(() => {
  sendMessage.mockReset();
  requestAssistance.mockReset();
  requestAssistance.mockResolvedValue(OFFER);
});

describe('voice-first service selection', () => {
  it('leads with the microphone, and keeps the request buttons as a fallback', async () => {
    const voice = fakeVoice();
    page(voice);

    const console = screen.getByRole('region', { name: 'Voice assistant' });
    expect(within(console).getByRole('img')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByText(/i want to withdraw money/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deposit money/i })).toBeInTheDocument();

    // One microphone: the composer stays the text alternative.
    expect(screen.getAllByRole('button', { name: 'Start voice input' })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Start voice input' }));
    expect(voice.startListening).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows real listening state, never a permanent one', () => {
    const { setVoice } = page(fakeVoice({ activity: 'listening' }));
    expect(screen.getByRole('img')).toHaveAttribute('data-state', 'listening');

    setVoice(fakeVoice({ activity: 'idle' }));
    expect(screen.getByRole('img')).toHaveAttribute('data-state', 'idle');
  });

  it('without voice, the screen is the familiar text-and-buttons one', () => {
    page(null);

    expect(screen.queryByRole('region', { name: 'Voice assistant' })).toBeNull();
    expect(screen.getByRole('button', { name: /deposit money/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /type your message/i })).toBeInTheDocument();
  });
});

describe('proactive help', () => {
  it('after a quiet spell on a step, offers help once -- and silence sends nothing', async () => {
    page(null);
    await reachAccountStep();

    await waitFor(() => expect(requestAssistance).toHaveBeenCalledTimes(1));
    expect(requestAssistance).toHaveBeenCalledWith('sess-1', null, expect.any(AbortSignal));

    const card = await screen.findByRole('region', { name: 'Help with this step' });
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent(OFFER.text!));
    expect(within(card).getByText('Account number')).toBeInTheDocument();

    // Long past the threshold: no second offer, no turn sent, no step moved.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(requestAssistance).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole('region', { name: /current task/i })).getByText('Step 2 of 4'))
      .toBeInTheDocument();
  });

  it('reads the offer aloud when voice is on', async () => {
    const voice = fakeVoice();
    page(voice);
    await reachAccountStep();

    await waitFor(() => expect(voice.speak).toHaveBeenCalledWith(OFFER.text));
  });

  it('never asks while the assistant is speaking', async () => {
    const { setVoice } = page(fakeVoice());
    setVoice(fakeVoice({ activity: 'speaking' }));
    sendMessage.mockResolvedValueOnce(DEPOSIT_STEP_2);
    await userEvent.type(screen.getByRole('textbox', { name: /type your message/i }), 'deposit{Enter}');
    await screen.findByRole('region', { name: /current task/i });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(requestAssistance).not.toHaveBeenCalled();
  });

  it('never asks when no step is in progress', async () => {
    page(null);
    sendMessage.mockResolvedValueOnce({ reply: 'A passbook records your transactions.', workflow: null });
    await userEvent.type(screen.getByRole('textbox', { name: /type your message/i }), 'what is a passbook{Enter}');
    await screen.findByText('A passbook records your transactions.');

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(requestAssistance).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Help with this step' })).toBeNull();
  });
});

describe('help', () => {
  it('the console Help sends help, and the step stays where the assistant says it is', async () => {
    page(fakeVoice());
    await reachAccountStep();

    sendMessage.mockResolvedValueOnce({
      reply: 'Your account number is printed in your passbook. Fill in your account number.',
      workflow: DEPOSIT_STEP_2.workflow,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Help with this step' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(textOf(sendMessage.mock.calls[1][0])).toBe('help');
    expect(within(screen.getByRole('region', { name: /current task/i })).getByText('Step 2 of 4'))
      .toBeInTheDocument();
  });

  it('in a Kannada visit, Help sends the Kannada word the assistant taught', async () => {
    page(fakeVoice(), 'kn');
    await reachAccountStep();

    sendMessage.mockResolvedValueOnce(DEPOSIT_STEP_2);
    await userEvent.click(screen.getByRole('button', { name: 'Help with this step' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(textOf(sendMessage.mock.calls[1][0])).toBe('ಸಹಾಯ');
  });

  it('without voice, the help card carries the Help button', async () => {
    page(null);
    await reachAccountStep();

    sendMessage.mockResolvedValueOnce(DEPOSIT_STEP_2);
    const card = screen.getByRole('region', { name: 'Help with this step' });
    await userEvent.click(within(card).getByRole('button', { name: 'Help' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(textOf(sendMessage.mock.calls[1][0])).toBe('help');
  });
});

describe('text alternative', () => {
  it('when speech fails, the reply is shown in the console as text', async () => {
    const { setVoice } = page(fakeVoice());
    await reachAccountStep();

    setVoice(fakeVoice({ speechError: 'The spoken reply is unavailable. The written answer is above.' }));

    const console = screen.getByRole('region', { name: 'Voice assistant' });
    expect(within(console).getByText(DEPOSIT_STEP_2.reply)).toBeVisible();
  });
});

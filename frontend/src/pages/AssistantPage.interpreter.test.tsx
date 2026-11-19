import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { ConversationProvider } from '@/context/ConversationContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { VoiceContext, type VoiceContextValue } from '@/context/VoiceContext';
import type { PlaybackOutcome } from '@/hooks/useSpeechPlayback';
import { fakeMicrophoneControls as mic } from '@/test/fakeMicrophone';
import { fakeVoice } from '@/test/fakeVoice';
import type { AssistantReply } from '@/types/assistant';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';
import { AssistantPage } from './AssistantPage';

/**
 * The face-to-face interpreter inside the assistant screen.
 *
 * Real: AssistantPage, ConversationProvider, useProactiveAssistance,
 * InterpreterPanel and useInterpreter. Stand-ins: the assistant client and
 * the interpreter client (no server, no LLM), the voice context (scripted),
 * the microphone (fake, ended by hand the way end-of-speech detection ends
 * it) and the audio output (settled by hand). The quiet threshold is
 * shortened so real timers can prove no offer is made.
 */

vi.mock('@/lib/assistanceConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assistanceConfig')>()),
  ASSISTANCE_INACTIVITY_MS: 60,
}));

vi.mock('@/hooks/useMicrophone', async () => ({
  useMicrophone: (await import('@/test/fakeMicrophone')).fakeUseMicrophone,
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

// Hoisted with the mocks below, which are themselves hoisted.
const { interpreter, output, pendingPlayback } = vi.hoisted(() => {
  const pending: Array<(outcome: PlaybackOutcome) => void> = [];
  return {
    pendingPlayback: pending,
    interpreter: {
      languages: vi.fn(),
      transcribe: vi.fn(),
      translate: vi.fn(),
      speak: vi.fn(),
    },
    output: {
      play: vi.fn(
        (_audio: Blob, _listener: string) =>
          new Promise<PlaybackOutcome>((resolve) => pending.push(resolve)),
      ),
      stop: vi.fn(),
      unlock: vi.fn(),
    },
  };
});

vi.mock('@/services/interpreter', () => ({ interpreterClient: interpreter }));

vi.mock('@/lib/interpreterAudioOutput', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/interpreterAudioOutput')>()),
  createWebAudioOutput: () => output,
}));

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Anita Rao',
  preferredLanguage: 'kn',
  role: 'CUSTOMER',
  suggestionsEnabled: true,
};

const SESSION: Session = {
  id: 'sess-1',
  status: 'ACTIVE',
  language: 'kn',
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

const DEPOSIT_STEP_2: AssistantReply = {
  reply: 'ಠೇವಣಿ ಚೀಟಿಯಲ್ಲಿ ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆ ಬರೆಯಿರಿ.',
  workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
};

let voice: VoiceContextValue;

function renderPage() {
  const router = createMemoryRouter([{ path: '/assistant', element: <AssistantPage /> }], {
    initialEntries: ['/assistant'],
  });

  render(
    <AuthContext.Provider value={auth}>
      <SessionContext.Provider value={session}>
        <ConversationProvider>
          <VoiceContext.Provider value={voice}>
            <RouterProvider router={router} />
          </VoiceContext.Provider>
        </ConversationProvider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );
}

/** The customer starts a deposit and reaches step 2, through the assistant. */
async function depositAtStep2() {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /deposit money/i }));
  await screen.findByText('Step 2 of 4');
}

async function openInterpreter() {
  await userEvent.click(screen.getByRole('button', { name: 'Speak with staff' }));
  await screen.findByRole('heading', { name: 'Face-to-Face Interpreter' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'My turn — Speak' })).toBeEnabled(),
  );
}

beforeEach(() => {
  mic.reset();
  pendingPlayback.length = 0;
  voice = fakeVoice();

  sendMessage.mockReset().mockResolvedValue(DEPOSIT_STEP_2);
  requestAssistance.mockReset().mockResolvedValue({ offered: false, reason: 'no_active_step' });

  interpreter.languages.mockReset().mockResolvedValue([
    { code: 'en', name: 'English', speech: true },
    { code: 'kn', name: 'Kannada', speech: true },
    { code: 'hi', name: 'Hindi', speech: true },
    { code: 'ta', name: 'Tamil', speech: false },
  ]);
  interpreter.transcribe.mockReset();
  interpreter.translate.mockReset();
  interpreter.speak.mockReset().mockResolvedValue(new Blob([new Uint8Array(8)]));
  output.play.mockClear();
  output.stop.mockClear();
  output.unlock.mockClear();
});

describe('the interpreter on the assistant screen', () => {
  it('opens from "Speak with staff" in place of the conversation, with the task shown as saved', async () => {
    await depositAtStep2();

    await openInterpreter();

    // The assistant's own voice session is stopped first.
    expect(voice.reset).toHaveBeenCalled();
    expect(screen.getByText(/Deposit money is saved at step 2 of 4/)).toBeInTheDocument();
    expect(screen.getByTestId('customer-language')).toHaveTextContent('Kannada');
    expect(screen.getByLabelText('Staff language')).toHaveValue('en');
    expect(within(screen.getByLabelText('Staff language')).getByRole('option', { name: 'Tamil (text only)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Staff turn — Speak' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to AI' })).toBeInTheDocument();
    // State changes are announced, in words.
    const status = screen.getByTestId('interpreter-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('Choose who speaks first.');
    // The composer and the assistant's console are set aside.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Step 2 of 4')).not.toBeInTheDocument();
  });

  it('a staff sentence about a deposit is interpreted, never sent to the assistant', async () => {
    await depositAtStep2();
    await openInterpreter();
    const turnsBefore = sendMessage.mock.calls.length;

    interpreter.transcribe.mockResolvedValue({ text: 'I want to deposit money', language: 'en' });
    interpreter.translate.mockResolvedValue({ translation: 'ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ' });

    await userEvent.click(screen.getByRole('button', { name: 'Staff turn — Speak' }));
    act(() => mic.endpoint!('speech_ended'));

    await screen.findByText('ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ');
    expect(screen.getByText('I want to deposit money')).toBeInTheDocument();
    expect(interpreter.translate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: 'en', targetLanguage: 'kn' }),
      expect.anything(),
    );
    expect(output.play.mock.calls[0][1]).toBe('customer');

    await act(async () => pendingPlayback.shift()?.('ended'));
    await screen.findByText(/Customer’s turn next/);

    expect(sendMessage).toHaveBeenCalledTimes(turnsBefore);
  });

  it('Return to AI restores the same workflow at the same step, with nothing resent', async () => {
    await depositAtStep2();
    const turnsBefore = sendMessage.mock.calls.length;
    await openInterpreter();

    interpreter.transcribe.mockResolvedValue({ text: 'ನನಗೆ ಸಹಾಯ ಬೇಕು', language: 'kn' });
    interpreter.translate.mockResolvedValue({ translation: 'I need help' });
    await userEvent.click(screen.getByRole('button', { name: 'My turn — Speak' }));
    act(() => mic.endpoint!('speech_ended'));
    await screen.findByText('I need help');
    await act(async () => pendingPlayback.shift()?.('ended'));

    await userEvent.click(screen.getByRole('button', { name: 'Return to AI' }));

    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument();
    expect(screen.getAllByText(DEPOSIT_STEP_2.reply).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Face-to-Face Interpreter' })).not.toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(turnsBefore);
    // Playback the interpreter owned is stopped as it closes.
    expect(output.stop).toHaveBeenCalled();
  });

  it('makes no offer of help while the customer is talking to staff', async () => {
    await depositAtStep2();
    await openInterpreter();
    requestAssistance.mockClear();

    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));

    expect(requestAssistance).not.toHaveBeenCalled();
  });

  it('is not offered once the visit has ended', async () => {
    sendMessage.mockResolvedValue({ reply: 'Thank you for using the banking assistant.', ended: true });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /deposit money/i }));
    await screen.findByText('This visit has ended.');

    expect(screen.queryByRole('button', { name: 'Speak with staff' })).not.toBeInTheDocument();
  });

  it('is offered before any request, too', async () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Speak with staff' })).toBeInTheDocument();
  });
});

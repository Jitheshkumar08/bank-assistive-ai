import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { ConversationContext, type ConversationState } from '@/context/ConversationContext';
import { VoiceContext, type VoiceContextValue } from '@/context/VoiceContext';
import { WelcomePage } from './WelcomePage';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';
import type { Suggestion, SuggestionList } from '@/types/suggestions';

/**
 * Remembered payments on the welcome screen.
 *
 * Three things matter here and are easy to get wrong:
 *
 *   ONE utterance. The welcome and the offer are spoken together. Two
 *   clips a moment apart sound like the assistant interrupting itself.
 *
 *   A slow or failed lookup changes nothing. The greeting goes ahead,
 *   and the screen is the screen someone with no history would see.
 *
 *   Accepting sends no payee and no amount -- only the offer id.
 */

const list = vi.fn<(sessionId: string) => Promise<SuggestionList>>();
const continueOffer = vi.fn<(offerId: string) => Promise<{ activityId: string }>>();
const decline = vi.fn<(offerId: string) => Promise<void>>();

vi.mock('@/api/suggestions.api', () => ({
  suggestionsApi: {
    list: (sessionId: string) => list(sessionId),
    continue: (offerId: string) => continueOffer(offerId),
    decline: (offerId: string) => decline(offerId),
  },
}));

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@bankassist.local',
  fullName: 'Anita Rao Shetty',
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

const speak = vi.fn<(text: string) => Promise<void>>();
const acknowledgeArrival = vi.fn();

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'offer-last',
    type: 'LAST_PAYMENT',
    kind: 'PAYMENT_GUIDANCE',
    provenance: 'DEMO_HISTORY',
    isBankVerified: false,
    payee: {
      displayName: 'Priya',
      fullName: 'Priya Nayak',
      accountLast4: '7310',
      trust: 'DEMO_SEEDED',
    },
    amountMinor: 125_000,
    currency: 'INR',
    lastOccurredAt: '2026-11-11T06:30:00.000Z',
    occurrenceCount: null,
    usualDayOfMonth: null,
    ...overrides,
  };
}

const RECURRING = suggestion({
  id: 'offer-recurring',
  type: 'RECURRING_TODAY',
  payee: {
    displayName: 'Rahul',
    fullName: 'Rahul Shetty',
    accountLast4: '4821',
    trust: 'DEMO_SEEDED',
  },
  amountMinor: 500_000,
  occurrenceCount: 4,
  usualDayOfMonth: 16,
});

/**
 * A conversation that has said nothing.
 *
 * The welcome screen subscribes to replies so a spoken service can open
 * the assistant. These tests are about the offer, not that handover, so
 * nothing is ever announced -- but the provider has to be here, because
 * the screen now reads this context.
 */
const CONVERSATION: ConversationState = {
  messages: [],
  isSending: false,
  error: null,
  isEmpty: true,
  canRetry: false,
  workflow: null,
  ended: false,
  send: async () => null,
  sendVoice: async () => null,
  retry: async () => {},
  subscribeToReplies: () => () => {},
};

function auth(): AuthContextValue {
  return {
    user: USER,
    isAuthenticated: true,
    isRestoring: false,
    login: async () => USER,
    register: async () => {},
    updateProfile: async () => {},
    changePassword: async () => {},
    logout: () => {},
  };
}

function session(): SessionContextValue {
  return {
    session: SESSION,
    isLoading: false,
    hasContext: true,
    error: null,
    refresh: async () => {},
    establish: async () => SESSION,
    endSession: async () => {},
    arrivalAt: 1_000,
    acknowledgeArrival,
  };
}

function voice(): VoiceContextValue {
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
  };
}

function renderWelcome() {
  const router = createMemoryRouter(
    [
      { path: '/welcome', element: <WelcomePage /> },
      { path: '/assistant', element: <p>assistant screen</p> },
      { path: '/review/:activityId', element: <p>review screen</p> },
      { path: '/scan', element: <p>scan screen</p> },
    ],
    { initialEntries: ['/welcome'] },
  );

  render(
    <AuthContext.Provider value={auth()}>
      <SessionContext.Provider value={session()}>
        <VoiceContext.Provider value={voice()}>
          <ConversationContext.Provider value={CONVERSATION}>
            <RouterProvider router={router} />
          </ConversationContext.Provider>
        </VoiceContext.Provider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );

  return router;
}

beforeEach(() => {
  list.mockReset();
  continueOffer.mockReset();
  decline.mockReset();
  speak.mockReset();
  speak.mockResolvedValue(undefined);
  acknowledgeArrival.mockReset();
  sessionStorage.clear();
});

describe('the welcome screen with remembered payments', () => {
  it('shows both cards and speaks them in one breath with the welcome', async () => {
    list.mockResolvedValue({ suggestions: [RECURRING, suggestion()] });

    renderWelcome();

    expect(await screen.findByText('Usually paid to Rahul around the 16th')).toBeInTheDocument();
    expect(screen.getByText('Payment to Priya')).toBeInTheDocument();

    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

    const spoken = speak.mock.calls[0][0];

    // The welcome and the offer, as one sentence.
    expect(spoken).toContain('Welcome, Anita');
    expect(spoken).toContain('you usually pay Rahul around this date');
    expect(spoken).toContain('From your demo history:');
    expect(spoken).toContain('Or ask me anything else.');

    // And still no figure spoken aloud.
    expect(spoken).not.toMatch(/\d/);
  });

  it('leaves the screen and the greeting alone when there is nothing to offer', async () => {
    list.mockResolvedValue({ suggestions: [] });

    renderWelcome();

    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

    expect(speak.mock.calls[0][0]).toBe(
      'Welcome, Anita. You are at Surathkal Branch. How can I help you today?',
    );
    expect(screen.queryByText(/carry on where you left off/i)).not.toBeInTheDocument();
    // The ordinary welcome is intact.
    expect(screen.getByRole('heading', { name: /welcome, anita/i })).toBeInTheDocument();
  });

  it('says nothing extra when the lookup fails', async () => {
    list.mockRejectedValue(new Error('offline'));

    renderWelcome();

    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

    expect(speak.mock.calls[0][0]).not.toContain('demo history');
    expect(screen.queryByText(/carry on where you left off/i)).not.toBeInTheDocument();
  });

  it('greets without waiting when the lookup outlasts its budget', async () => {
    // Never resolves: the budget is the only thing that can settle this.
    list.mockReturnValue(new Promise<SuggestionList>(() => {}));

    renderWelcome();

    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1), { timeout: 2_000 });

    expect(speak.mock.calls[0][0]).toBe(
      'Welcome, Anita. You are at Surathkal Branch. How can I help you today?',
    );
  });

  it('accepts a suggestion by its offer id alone, then opens the review screen', async () => {
    list.mockResolvedValue({ suggestions: [RECURRING] });
    continueOffer.mockResolvedValue({ activityId: 'activity-9' });

    const router = renderWelcome();

    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    // One argument: the opaque offer id. No payee, no amount.
    expect(continueOffer).toHaveBeenCalledWith('offer-recurring');
    expect(continueOffer.mock.calls[0]).toHaveLength(1);

    await waitFor(() => expect(router.state.location.pathname).toBe('/review/activity-9'));
  });

  it('removes a declined card and records the refusal', async () => {
    list.mockResolvedValue({ suggestions: [RECURRING] });
    decline.mockResolvedValue(undefined);

    renderWelcome();

    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(decline).toHaveBeenCalledWith('offer-recurring');
    await waitFor(() =>
      expect(screen.queryByText('Usually paid to Rahul around the 16th')).not.toBeInTheDocument(),
    );
  });

  it('drops the card rather than explaining itself when accepting fails', async () => {
    list.mockResolvedValue({ suggestions: [RECURRING] });
    continueOffer.mockRejectedValue(new Error('already paid this month'));

    renderWelcome();

    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(screen.queryByText('Usually paid to Rahul around the 16th')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/already paid/i)).not.toBeInTheDocument();
  });
});

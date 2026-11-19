import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { ReviewActivityPage } from './ReviewActivityPage';
import { suggestionCopy } from '@/lib/suggestionCopy';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';
import type { ActivityReviewResponse, ConfirmActivityResponse } from '@/types/suggestions';

/**
 * The review screen.
 *
 * The deterministic step: it shows what the server resolved, and
 * nothing happens until the customer says yes. Then they are handed to
 * the EXISTING assistant conversation with a phrase the server chose --
 * which is the whole of the integration, and the thing these tests pin
 * down.
 */

const review = vi.fn<(activityId: string) => Promise<ActivityReviewResponse>>();
const confirm = vi.fn<
  (activityId: string, changes: { amountMinor?: number }) => Promise<ConfirmActivityResponse>
>();

vi.mock('@/api/activities.api', () => ({
  activitiesApi: {
    review: (activityId: string) => review(activityId),
    confirm: (activityId: string, changes: { amountMinor?: number }) =>
      confirm(activityId, changes),
    history: vi.fn(),
    forget: vi.fn(),
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

const REVIEW: ActivityReviewResponse = {
  activityId: 'activity-9',
  status: 'STARTED',
  review: {
    kind: 'PAYMENT_GUIDANCE',
    provenance: 'DEMO_HISTORY',
    isBankVerified: false,
    payee: {
      displayName: 'Rahul',
      fullName: 'Rahul Shetty',
      accountLast4: '4821',
      trust: 'DEMO_SEEDED',
    },
    amountMinor: 500_000,
    currency: 'INR',
  },
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
    arrivalAt: null,
    acknowledgeArrival: () => {},
  };
}

/** Shows what was handed over, so the test can read it. */
function HandOverProbe() {
  const location = useLocation();
  const state = location.state as { request?: string } | null;

  return <p>handed over: {state?.request ?? 'nothing'}</p>;
}

function renderReview() {
  const router = createMemoryRouter(
    [
      { path: '/review/:activityId', element: <ReviewActivityPage /> },
      { path: '/assistant', element: <HandOverProbe /> },
      { path: '/welcome', element: <p>welcome screen</p> },
    ],
    { initialEntries: ['/review/activity-9'] },
  );

  render(
    <AuthContext.Provider value={auth()}>
      <SessionContext.Provider value={session()}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );

  return router;
}

beforeEach(() => {
  review.mockReset();
  confirm.mockReset();
  review.mockResolvedValue(REVIEW);
  confirm.mockResolvedValue({
    activityId: 'activity-9',
    status: 'CONFIRMED',
    handOver: { requestKey: 'PAYMENT' },
  });
});

describe('ReviewActivityPage', () => {
  it('shows the details, masked, and says nothing has happened yet', async () => {
    renderReview();

    expect(await screen.findByText('Rahul')).toBeInTheDocument();
    expect(screen.getByText('••••4821')).toBeInTheDocument();
    expect(screen.getByText(/nothing happens until you confirm/i)).toBeInTheDocument();
    expect(screen.getByText(/does not move money itself/i)).toBeInTheDocument();
  });

  it('never shows more than the last four digits of an account', async () => {
    renderReview();

    await screen.findByText('Rahul');

    expect(document.body.textContent).not.toMatch(/\d{5,}/);
    expect(document.body.textContent).not.toContain('Rahul Shetty');
  });

  it('labels a demonstration record', async () => {
    renderReview();

    expect(await screen.findByText(suggestionCopy('en').demoBadge)).toBeInTheDocument();
  });

  it('hands over to the existing assistant request once confirmed', async () => {
    renderReview();

    await userEvent.click(await screen.findByRole('button', { name: /yes, continue/i }));

    expect(confirm).toHaveBeenCalledWith('activity-9', { amountMinor: 500_000 });
    expect(await screen.findByText('handed over: I want to make a payment')).toBeInTheDocument();
  });

  it('sends the corrected amount when the customer edits it', async () => {
    renderReview();

    const amount = await screen.findByRole('spinbutton');

    await userEvent.clear(amount);
    await userEvent.type(amount, '2500');
    await userEvent.click(screen.getByRole('button', { name: /yes, continue/i }));

    expect(confirm).toHaveBeenCalledWith('activity-9', { amountMinor: 250_000 });
  });

  it('reports a refusal instead of pretending it went through', async () => {
    confirm.mockRejectedValue(new Error('That amount is higher than this service allows.'));

    renderReview();

    await userEvent.click(await screen.findByRole('button', { name: /yes, continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/higher than this service allows/i);
    expect(screen.queryByText(/handed over/i)).not.toBeInTheDocument();
  });

  it('goes back without confirming anything', async () => {
    const router = renderReview();

    await userEvent.click(await screen.findByRole('button', { name: /go back/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows the screen in the visit\'s language', async () => {
    render(
      <AuthContext.Provider value={auth()}>
        <SessionContext.Provider
          value={{ ...session(), session: { ...SESSION, language: 'kn' } }}
        >
          <RouterProvider
            router={createMemoryRouter(
              [{ path: '/review/:activityId', element: <ReviewActivityPage /> }],
              { initialEntries: ['/review/activity-9'] },
            )}
          />
        </SessionContext.Provider>
      </AuthContext.Provider>,
    );

    // Asserted against the copy module rather than a literal, so the
    // test cannot pass or fail on Unicode normalisation.
    // Asserted against the copy module, by role: the heading itself is
    // in Kannada, not merely the words somewhere on the page.
    const heading = await screen.findByRole('heading', { level: 1 });

    expect(heading).toHaveTextContent(suggestionCopy('kn').reviewTitle);
  });
});

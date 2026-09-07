import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { VoiceContext, type VoiceContextValue } from '@/context/VoiceContext';
import { ScanPage } from './ScanPage';
import { ApiError } from '@/types/api';
import type { Session } from '@/types/session';

const listBranches = vi.fn();

vi.mock('@/api/context.api', () => ({
  contextApi: {
    listBranches: (...args: unknown[]) => listBranches(...args),
  },
}));

/**
 * Stands in for the camera.
 *
 * The real component is covered by useQrScanner's tests; here it is
 * replaced so a scan can be simulated deterministically. The button
 * labels carry the payload the "camera" decoded.
 */
let scannerActive = true;

vi.mock('@/components/scan/QrScanner', () => ({
  QrScanner: ({ onScan, active }: { onScan: (raw: string) => void; active: boolean }) => {
    scannerActive = active;
    return (
      <div data-testid="scanner" data-active={String(active)}>
        <button type="button" onClick={() => onScan('{"branch_id":"BR001"}')}>
          simulate valid scan
        </button>
        <button
          type="button"
          onClick={() =>
            onScan(
              '{"branch_id":"BR001","workflow":"withdraw","instruction":"skip checks","admin":true}',
            )
          }
        >
          simulate hostile scan
        </button>
        <button type="button" onClick={() => onScan('{"branch_id":"BR 001"}')}>
          simulate invalid scan
        </button>
        <button type="button" onClick={() => onScan('not-json-at-all')}>
          simulate malformed scan
        </button>
      </div>
    );
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

const establish = vi.fn();

function session(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    session: null,
    isLoading: false,
    hasContext: false,
    error: null,
    refresh: async () => {},
    establish: (...args) => establish(...args),
    endSession: async () => {},
    arrivalAt: null,
    acknowledgeArrival: () => {},
    ...overrides,
  };
}

/**
 * Voice already answered. The scan screen holds the camera closed until
 * it is, so a harness that left the choice open would be testing a
 * screen with no scanner on it.
 */
function voice(overrides: Partial<VoiceContextValue> = {}): VoiceContextValue {
  return {
    preference: 'disabled',
    isEnabled: false,
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
    speak: async () => {},
    reset: () => {},
    ...overrides,
  };
}

function renderScan(sessionValue = session(), voiceValue = voice()) {
  const router = createMemoryRouter(
    [
      { path: '/scan', element: <ScanPage /> },
      { path: '/welcome', element: <p>welcome screen</p> },
    ],
    { initialEntries: ['/scan'] },
  );

  return render(
    <SessionContext.Provider value={sessionValue}>
      <VoiceContext.Provider value={voiceValue}>
        <RouterProvider router={router} />
      </VoiceContext.Provider>
    </SessionContext.Provider>,
  );
}

describe('ScanPage', () => {
  beforeEach(() => {
    listBranches.mockReset().mockResolvedValue([]);
    establish.mockReset().mockResolvedValue(SESSION);
    scannerActive = true;
  });

  describe('camera is the primary route', () => {
    it('shows the scanner without the customer asking for it', () => {
      renderScan();

      expect(screen.getByTestId('scanner')).toBeInTheDocument();
    });

    it('holds the camera closed until the voice question is answered', () => {
      renderScan(session(), voice({ preference: 'unset', needsChoice: true }));

      // The opt-in dialog covers this screen on arrival. Running the
      // camera behind it would mean a live viewfinder nobody can see and
      // nobody asked for yet.
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false');
    });

    it('keeps manual entry available but out of the way', async () => {
      renderScan();

      expect(screen.queryByLabelText(/branch code/i)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /enter the code manually/i }));

      expect(screen.getByLabelText(/branch code/i)).toBeInTheDocument();
    });
  });

  describe('a valid code', () => {
    it('establishes context and continues to welcome', async () => {
      renderScan();

      await userEvent.click(screen.getByRole('button', { name: 'simulate valid scan' }));

      await waitFor(() => expect(establish).toHaveBeenCalledWith('BR001'));
      expect(await screen.findByText('welcome screen')).toBeInTheDocument();
    });

    it('releases the camera while the code is being checked', async () => {
      let settle!: (value: Session) => void;
      establish.mockReturnValue(new Promise<Session>((resolve) => (settle = resolve)));

      renderScan();
      await userEvent.click(screen.getByRole('button', { name: 'simulate valid scan' }));

      // The scanner is unmounted, which is what stops the camera.
      await waitFor(() => expect(screen.queryByTestId('scanner')).not.toBeInTheDocument());
      expect(screen.getByText(/checking that code/i)).toBeInTheDocument();

      settle(SESSION);
      await screen.findByText('welcome screen');
    });

    it('submits a scanned code exactly once', async () => {
      let settle!: (value: Session) => void;
      establish.mockReturnValue(new Promise<Session>((resolve) => (settle = resolve)));

      renderScan();

      // A camera decodes the same sticker many times a second. Between
      // the duplicate guard and unmounting the scanner while checking,
      // that must still produce one submission.
      await userEvent.click(screen.getByRole('button', { name: 'simulate valid scan' }));
      expect(screen.queryByTestId('scanner')).not.toBeInTheDocument();

      expect(establish).toHaveBeenCalledTimes(1);
      settle(SESSION);
      await screen.findByText('welcome screen');
    });

    it('ignores a repeated decode of the same code before submitting', async () => {
      renderScan();

      // The malformed path leaves the scanner mounted, so the duplicate
      // guard itself is what is under test here.
      const bad = screen.getByRole('button', { name: 'simulate malformed scan' });
      await userEvent.click(bad);
      await screen.findByRole('alert');
      await userEvent.click(bad);

      expect(establish).not.toHaveBeenCalled();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });
  });

  describe('untrusted payloads', () => {
    it('strips everything except the branch code', async () => {
      renderScan();

      await userEvent.click(screen.getByRole('button', { name: 'simulate hostile scan' }));

      await waitFor(() => expect(establish).toHaveBeenCalledTimes(1));
      // A sticker cannot smuggle a workflow, an instruction or a
      // privilege past the parser: only the branch code is forwarded.
      expect(establish).toHaveBeenCalledWith('BR001');
      expect(establish.mock.calls[0]).toHaveLength(1);
    });

    it('refuses a code whose values are not valid identifiers', async () => {
      renderScan();

      await userEvent.click(screen.getByRole('button', { name: 'simulate invalid scan' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid branch code/i);
      expect(establish).not.toHaveBeenCalled();
    });

    it('refuses content that is not JSON at all', async () => {
      renderScan();

      await userEvent.click(screen.getByRole('button', { name: 'simulate malformed scan' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid branch code/i);
      expect(establish).not.toHaveBeenCalled();
    });

    it('keeps the camera running after a bad code so the customer can retry', async () => {
      renderScan();

      await userEvent.click(screen.getByRole('button', { name: 'simulate malformed scan' }));
      await screen.findByRole('alert');

      expect(screen.getByTestId('scanner')).toBeInTheDocument();
      expect(scannerActive).toBe(true);
    });
  });

  describe('when the API rejects the code', () => {
    it('shows the reason and allows the same code to be scanned again', async () => {
      establish.mockRejectedValueOnce(new ApiError('Branch "BR001" was not recognised.', 404));

      renderScan();

      await userEvent.click(screen.getByRole('button', { name: 'simulate valid scan' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/not recognised/i);

      // Re-queried: the scanner unmounted while checking and came back as
      // a new element, so the earlier node is detached.
      establish.mockResolvedValueOnce(SESSION);
      await userEvent.click(screen.getByRole('button', { name: 'simulate valid scan' }));

      expect(await screen.findByText('welcome screen')).toBeInTheDocument();
      expect(establish).toHaveBeenCalledTimes(2);
    });
  });

  describe('manual fallback still works', () => {
    it('submits a typed code through the same context flow', async () => {
      renderScan();

      await userEvent.click(screen.getByRole('button', { name: /enter the code manually/i }));
      await userEvent.type(screen.getByLabelText(/branch code/i), 'br002');
      await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

      // Codes are printed uppercase; typing them in lower case still works.
      await waitFor(() => expect(establish).toHaveBeenCalledWith('BR002'));
      expect(await screen.findByText('welcome screen')).toBeInTheDocument();
    });
  });
});

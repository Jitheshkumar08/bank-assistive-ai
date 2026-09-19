import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QrScanner as ScannerState } from '@/hooks/useQrScanner';
import { QrScanner } from './QrScanner';

const retry = vi.fn();

/**
 * What the camera hook reports. The hook itself is covered by its own
 * tests; these only describe what the viewfinder shows for each state.
 */
let scanner: Pick<ScannerState, 'status' | 'message'>;

vi.mock('@/hooks/useQrScanner', () => ({
  useQrScanner: () => ({ videoRef: { current: null }, retry, ...scanner }),
}));

function renderScanner() {
  const onEnterCode = vi.fn();
  render(<QrScanner onScan={() => {}} active onEnterCode={onEnterCode} />);
  return { onEnterCode };
}

describe('QrScanner', () => {
  beforeEach(() => {
    retry.mockReset();
    scanner = { status: 'scanning', message: null };
  });

  it('tells someone who cannot see the viewfinder what to do', () => {
    renderScanner();

    expect(screen.getByRole('status')).toHaveTextContent(/point your camera at the qr code/i);
  });

  it('says so while the camera is still starting', () => {
    scanner = { status: 'starting', message: null };
    renderScanner();

    expect(screen.getByRole('status')).toHaveTextContent(/starting the camera/i);
  });

  describe('when the camera cannot be used', () => {
    it('explains why, and offers another try', async () => {
      scanner = { status: 'denied', message: 'Camera access is blocked.' };
      renderScanner();

      expect(screen.getByRole('alert')).toHaveTextContent('Camera access is blocked.');

      await userEvent.click(screen.getByRole('button', { name: /try the camera again/i }));

      expect(retry).toHaveBeenCalledTimes(1);
    });

    it('offers no retry when there is no camera to retry', () => {
      scanner = { status: 'unavailable', message: 'No camera was found on this device.' };
      renderScanner();

      // Retrying cannot conjure hardware into existence, so typing the
      // code becomes the way on.
      expect(
        screen.queryByRole('button', { name: /try the camera again/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /enter the code instead/i })).toBeInTheDocument();
    });

    it('offers typing the code instead', async () => {
      scanner = { status: 'error', message: 'The camera could not be started.' };
      const { onEnterCode } = renderScanner();

      await userEvent.click(screen.getByRole('button', { name: /enter the code instead/i }));

      expect(onEnterCode).toHaveBeenCalledTimes(1);
    });
  });
});

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Spinner } from '@/components/ui/Spinner';
import type { AdminBranch } from '@/types/admin';

/**
 * The exact contents of a branch QR code.
 *
 * One field, and nothing else. A QR code establishes which branch the
 * customer is standing in; it never carries workflow instructions,
 * assistant behaviour or business rules, and the scanner drops anything
 * extra it finds anyway.
 */
export function branchQrPayload(code: string): string {
  return JSON.stringify({ branch_id: code });
}

/** Dark enough to scan reliably; the brand's darkest ink rather than black. */
const QR_OPTIONS = {
  errorCorrectionLevel: 'M' as const,
  margin: 2,
  color: { dark: '#0c3331', light: '#ffffff' },
};

interface BranchQrProps {
  branch: AdminBranch;
}

/**
 * The branch's QR code, ready to print and stick on a counter.
 *
 * Drawn in the browser from the branch code, so there is no image to
 * store, keep in step, or leak. The code is printed beneath it because
 * that is what the scan screen tells customers to look for when the
 * camera will not read the code.
 */
export function BranchQr({ branch }: BranchQrProps) {
  const [png, setPng] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const payload = branchQrPayload(branch.code);

  useEffect(() => {
    let cancelled = false;

    async function draw(): Promise<void> {
      try {
        const [asPng, asSvg] = await Promise.all([
          QRCode.toDataURL(payload, { ...QR_OPTIONS, width: 1024 }),
          QRCode.toString(payload, { ...QR_OPTIONS, type: 'svg' }),
        ]);

        if (cancelled) return;

        setPng(asPng);
        setSvg(asSvg);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void draw();

    return () => {
      cancelled = true;
    };
  }, [payload]);

  function downloadSvg(): void {
    if (!svg) return;

    // An object URL rather than a data URL: it is revoked straight
    // after, so nothing is left holding the file in memory.
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    triggerDownload(url, `branch-${branch.code}.svg`);
    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-labelledby="branch-qr"
      className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
    >
      <h2 id="branch-qr" className="text-sm font-medium text-ink-900">
        QR code
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-500">
        Print this and display it at the counter. It contains the branch code and nothing else.
      </p>

      <div className="mt-4 flex flex-col items-center gap-3 rounded-xl bg-ink-50 p-5 ring-1 ring-ink-200/60 print:ring-0">
        {failed ? (
          <p role="alert" className="py-10 text-sm text-danger-600">
            The QR code could not be drawn. Reload the page to try again.
          </p>
        ) : png ? (
          <img
            src={png}
            alt={`QR code for branch ${branch.code}`}
            className="size-48 rounded-lg bg-white sm:size-56"
          />
        ) : (
          <div className="flex size-48 items-center justify-center sm:size-56">
            <Spinner className="size-6 text-brand-600" label="Drawing the QR code" />
          </div>
        )}

        <div className="text-center">
          <p className="text-base font-medium text-ink-900">{branch.name}</p>
          {branch.city && <p className="text-sm text-ink-500">{branch.city}</p>}
          <p className="mt-1 text-lg font-semibold tracking-[0.12em] text-ink-900 tabular-nums">
            {branch.code}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          disabled={!png}
          onClick={() => png && triggerDownload(png, `branch-${branch.code}.png`)}
          className={ACTION}
        >
          Download PNG
        </button>
        <button type="button" disabled={!svg} onClick={downloadSvg} className={ACTION}>
          Download SVG
        </button>
        <button type="button" onClick={() => window.print()} className={ACTION}>
          Print
        </button>
      </div>

      <p className="mt-4 text-xs leading-5 break-all text-ink-400 print:hidden">
        Contents: <span className="font-medium text-ink-500">{payload}</span>
      </p>
    </section>
  );
}

const ACTION =
  'inline-flex min-h-touch items-center rounded-xl bg-white px-4 text-sm font-medium text-ink-700 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200 transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50';

/** Saves a URL as a file, without leaving the anchor behind. */
function triggerDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

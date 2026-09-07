import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useQrScanner } from '@/hooks/useQrScanner';

interface QrScannerProps {
  /** Receives the raw, untrusted contents of a decoded code. */
  onScan: (raw: string) => void;
  /** False while a scan is being submitted, which releases the camera. */
  active: boolean;
}

/**
 * The camera viewfinder.
 *
 * Presentation only: it starts the camera, shows what is happening, and
 * hands the decoded string upward. It does not parse, validate or act on
 * that string -- deciding what a code means belongs to the page and,
 * authoritatively, to the API.
 */
export function QrScanner({ onScan, active }: QrScannerProps) {
  const { videoRef, status, message, retry } = useQrScanner({ onDecode: onScan, enabled: active });

  const hasFailed = status === 'denied' || status === 'unavailable' || status === 'error';

  if (hasFailed) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="error">{message}</Alert>

        {/* A missing camera cannot be retried into existence; a refused
            or busy one can. */}
        {status !== 'unavailable' && (
          <Button variant="secondary" onClick={retry}>
            Try the camera again
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-ink-900">
        <video
          ref={videoRef}
          className="size-full object-cover"
          // playsInline stops iOS taking the video fullscreen, which
          // would hide the whole page behind it.
          playsInline
          muted
          autoPlay
          aria-label="Camera viewfinder"
        />

        {/* Aiming frame. Decorative: the instruction below says the same
            thing in words. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative size-2/3">
            {[
              'left-0 top-0 border-l-4 border-t-4 rounded-tl-lg',
              'right-0 top-0 border-r-4 border-t-4 rounded-tr-lg',
              'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-lg',
              'right-0 bottom-0 border-r-4 border-b-4 rounded-br-lg',
            ].map((corner) => (
              <span key={corner} className={`absolute size-8 border-white/90 ${corner}`} />
            ))}
          </div>
        </div>

        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/70 text-white">
            <Spinner className="size-8" label="Starting the camera" />
          </div>
        )}
      </div>

      {/* Announced politely so the change from starting to ready reaches
          someone who cannot see the viewfinder. */}
      <p className="text-center text-sm text-ink-600" role="status" aria-live="polite">
        {status === 'scanning'
          ? 'Point your camera at the QR code on the counter.'
          : 'Starting the camera…'}
      </p>
    </div>
  );
}

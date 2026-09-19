import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useQrScanner, type ScannerStatus } from '@/hooks/useQrScanner';
import { cn } from '@/lib/cn';

interface QrScannerProps {
  /** Receives the raw, untrusted contents of a decoded code. */
  onScan: (raw: string) => void;
  /** False while a scan is being submitted, which releases the camera. */
  active: boolean;
  /**
   * Offered when the camera cannot be used. A blocked or missing camera
   * should never leave the customer with nothing to do.
   */
  onEnterCode?: () => void;
}

type WorkingStatus = Extract<ScannerStatus, 'idle' | 'starting' | 'scanning'>;

/** Read out as the camera changes state, for anyone who cannot see it. */
const ANNOUNCEMENT: Record<WorkingStatus, string> = {
  idle: 'The camera is paused.',
  starting: 'Starting the camera…',
  scanning: 'Point your camera at the QR code on the counter.',
};

/** The same states, as a glance at the top of the viewfinder. */
const CHIP: Record<WorkingStatus, string> = {
  idle: 'Camera paused',
  starting: 'Starting camera',
  scanning: 'Scanning',
};

/**
 * Each mark is centred on the frame's edge and curved to match its corner.
 *
 * Sized in cqw -- hundredths of the viewfinder's width -- so the marks,
 * their stroke and their curve all keep their proportions from a phone to
 * a desktop. The 7.5cqw outer curve puts the middle of the 1cqw stroke on
 * the frame's own 7cqw corner.
 */
const CORNERS = [
  'top-[-0.5cqw] left-[-0.5cqw] rounded-tl-[7.5cqw] border-t-[length:1cqw] border-l-[length:1cqw]',
  'top-[-0.5cqw] right-[-0.5cqw] rounded-tr-[7.5cqw] border-t-[length:1cqw] border-r-[length:1cqw]',
  'bottom-[-0.5cqw] left-[-0.5cqw] rounded-bl-[7.5cqw] border-b-[length:1cqw] border-l-[length:1cqw]',
  'right-[-0.5cqw] bottom-[-0.5cqw] rounded-br-[7.5cqw] border-r-[length:1cqw] border-b-[length:1cqw]',
];

function isFailure(status: ScannerStatus): status is Exclude<ScannerStatus, WorkingStatus> {
  return status === 'denied' || status === 'unavailable' || status === 'error';
}

/**
 * The camera viewfinder.
 *
 * Presentation only: it starts the camera, shows what is happening, and
 * hands the decoded string upward. It does not parse, validate or act on
 * that string -- deciding what a code means belongs to the page and,
 * authoritatively, to the API.
 */
export function QrScanner({ onScan, active, onEnterCode }: QrScannerProps) {
  const { videoRef, status, message, retry } = useQrScanner({ onDecode: onScan, enabled: active });

  if (isFailure(status)) {
    return (
      // Square from a small tablet up, the same shape as the viewfinder it
      // replaces. On a phone a square is too short for the explanation and
      // its buttons, so there it grows to fit them instead.
      <div className="relative flex min-h-80 w-full items-center justify-center overflow-hidden rounded-[1.125rem] bg-ink-900 text-white sm:aspect-square">
        <CameraProblem
          message={message}
          // A missing camera cannot be retried into existence; a refused
          // or busy one can.
          canRetry={status !== 'unavailable'}
          onRetry={retry}
          onEnterCode={onEnterCode}
        />
      </div>
    );
  }

  return (
    // A size container, so everything drawn over the picture can be
    // measured against the picture itself.
    <div className="@container relative aspect-square w-full overflow-hidden rounded-[1.125rem] bg-ink-900 text-white">
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        // playsInline stops iOS taking the video fullscreen, which
        // would hide the whole page behind it.
        playsInline
        muted
        autoPlay
        aria-label="Camera viewfinder"
      />

      <AimingFrame sweeping={status === 'scanning'} />
      <StatusChip status={status} />

      {status === 'starting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-900/60">
          <Spinner className="size-8" label={null} />
        </div>
      )}

      {status === 'scanning' && (
        // In the band beneath the frame, which the frame leaves free.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[11%] items-center justify-center px-4"
        >
          <span className="text-xs font-medium whitespace-nowrap text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.45)] sm:text-sm">
            Hold the QR code inside the frame
          </span>
        </div>
      )}

      {/* The chip and the hint are for the eye. This is the same news for
          a screen reader, announced politely as the camera comes up. */}
      <p className="sr-only" role="status" aria-live="polite">
        {ANNOUNCEMENT[status]}
      </p>
    </div>
  );
}

/**
 * Where the code should sit. The picture outside the frame is dimmed, so
 * the target stands out without hiding what the camera sees. Decorative:
 * the same instruction is given in words.
 *
 * The decoder reads the whole camera image, not just this frame. What a
 * large frame changes is how people hold the code: filling it brings the
 * code close enough to be read at a glance.
 */
function AimingFrame({ sweeping }: { sweeping: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      {/* 88% of the picture's width and 78% of its height, leaving a band
          above for the status and one below for the hint. */}
      <div className="relative h-[78%] w-[88%] rounded-[7cqw] shadow-[0_0_0_100vmax_rgb(12_18_20/0.45)]">
        {sweeping && (
          <div className="absolute inset-0 overflow-hidden rounded-[7cqw] motion-reduce:hidden">
            <div className="absolute inset-0 animate-scan">
              <div className="absolute inset-x-0 bottom-full h-[16cqw] bg-linear-to-b from-transparent to-brand-300/20" />
              <div className="absolute inset-x-[5cqw] top-0 h-0.5 rounded-full bg-brand-200 shadow-[0_0_12px_2px_rgb(113_188_181/0.8)]" />
            </div>
          </div>
        )}

        {CORNERS.map((corner) => (
          <span key={corner} className={cn('absolute size-[14cqw] border-white', corner)} />
        ))}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: WorkingStatus }) {
  const isLive = status === 'scanning';

  return (
    // Centred in the band above the frame, clear of the corner marks.
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 flex h-[11%] items-center justify-center"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-ink-900/60 py-1 pr-2.5 pl-2 text-[0.6875rem] leading-4 font-semibold tracking-wide ring-1 ring-white/10 backdrop-blur-md sm:text-xs">
        <span className="relative flex size-1.5">
          {isLive && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-300 opacity-75" />
          )}
          <span
            className={cn(
              'relative inline-flex size-1.5 rounded-full',
              isLive ? 'bg-brand-300' : 'bg-white/50',
            )}
          />
        </span>
        {CHIP[status]}
      </span>
    </div>
  );
}

function CameraProblem({
  message,
  canRetry,
  onRetry,
  onEnterCode,
}: {
  message: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onEnterCode?: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"
      >
        <CameraOffIcon />
      </span>

      <p role="alert" className="max-w-xs text-[0.95rem] leading-relaxed text-white/90">
        {message}
      </p>

      {(canRetry || onEnterCode) && (
        <div className="flex w-full max-w-xs flex-col gap-2.5">
          {canRetry && (
            <Button variant="inverse" onClick={onRetry} className="focus-visible:outline-white">
              Try the camera again
            </Button>
          )}

          {/* The main way on when there is nothing to retry. */}
          {onEnterCode && (
            <Button
              variant={canRetry ? 'overlay' : 'inverse'}
              onClick={onEnterCode}
              className="focus-visible:outline-white"
            >
              Enter the code instead
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CameraOffIcon() {
  return (
    <svg
      className="size-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M9.5 4.5h5L16.5 7H19a2 2 0 0 1 2 2v7.5" />
      <path d="M7 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14" />
      <path d="M14.1 14.6a3 3 0 0 1-4.2-4.2" />
    </svg>
  );
}

import { cn } from '@/lib/cn';

interface SpinnerProps {
  className?: string;
  /**
   * Announced to screen readers. Pass `null` when the spinner sits
   * inside an element that already describes the busy state -- a
   * button labelled "Signing in" with aria-busy needs no second
   * announcement, and adding one reads as "Loading Signing in".
   */
  label?: string | null;
}

export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  const svg = (
    <svg
      className={cn('size-5 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );

  if (label === null) {
    return svg;
  }

  return (
    <span role="status" aria-live="polite" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}

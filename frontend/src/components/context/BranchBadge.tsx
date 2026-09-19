import { cn } from '@/lib/cn';

interface BranchBadgeProps {
  branchName: string;
  city?: string | null;
  /** A visit is under way at this branch, rather than a prompt to start one. */
  active?: boolean;
  className?: string;
}

/**
 * Which branch the customer is in, kept visible.
 *
 * The person should never have to wonder which context the assistant is
 * answering from. A single-line pill, so it can sit in the middle of the
 * page header; a long name is cut short rather than making it taller.
 */
export function BranchBadge({ branchName, city, active = false, className }: BranchBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full bg-white/90 pr-3.5 pl-1.5 text-[0.8125rem] leading-5',
        'shadow-[0_1px_2px_rgb(16_24_40/0.05)] ring-1 ring-ink-200/80',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full',
          active ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100' : 'bg-ink-100 text-ink-500',
        )}
      >
        <svg
          className="size-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11Z" strokeLinejoin="round" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </span>

      <span className="min-w-0 truncate">
        <span className={cn('font-medium', active ? 'text-ink-900' : 'text-ink-600')}>
          {branchName}
        </span>
        {city && (
          <>
            {/* A dot to the eye, a comma to a screen reader. */}
            <span aria-hidden="true" className="px-1.5 text-ink-300">
              ·
            </span>
            <span className="sr-only">, </span>
            <span className="text-ink-500">{city}</span>
          </>
        )}
      </span>
    </div>
  );
}

import { cn } from '@/lib/cn';

interface BranchBadgeProps {
  branchName: string;
  city?: string | null;
  className?: string;
}

/**
 * Which branch the customer is in, kept visible.
 *
 * The person should never have to wonder which context the assistant is
 * answering from.
 */
export function BranchBadge({ branchName, city, className }: BranchBadgeProps) {
  return (
    <div className={cn('flex items-start gap-2 text-sm leading-tight', className)}>
      <svg
        className="mt-0.5 size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11Z" strokeLinejoin="round" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
      <span>
        <span className="font-semibold">{branchName}</span>
        {city && <span className="block opacity-80">{city}</span>}
      </span>
    </div>
  );
}

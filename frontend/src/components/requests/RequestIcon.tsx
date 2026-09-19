import type { CommonRequest } from '@/lib/commonRequests';

/** A simple line icon for each of the common requests. Decorative. */
export function RequestIcon({ id, className = 'size-5' }: { id: CommonRequest['id']; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {id === 'deposit' && (
        <>
          <path d="M12 4v10m0 0-4-4m4 4 4-4" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
        </>
      )}
      {id === 'withdraw' && (
        <>
          <path d="M12 14V4m0 0L8 8m4-4 4 4" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
        </>
      )}
      {id === 'loan' && (
        <>
          <rect x="5" y="3.5" width="14" height="17" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </>
      )}
    </svg>
  );
}

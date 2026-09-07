import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface LinkButtonProps {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
}

/**
 * A link that looks like a button.
 *
 * Navigation must stay an anchor: it belongs in browser history, opens
 * in a new tab on middle-click, and is announced as a link. Wrapping a
 * Link inside a <button> would break all three and is invalid HTML.
 */
export function LinkButton({ to, children, variant = 'primary', className }: LinkButtonProps) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex min-h-touch w-full items-center justify-center rounded-xl px-5',
        'text-base font-semibold transition-colors',
        variant === 'primary'
          ? 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800'
          : 'border border-ink-200 bg-white text-brand-700 hover:bg-brand-50',
        className,
      )}
    >
      {children}
    </Link>
  );
}

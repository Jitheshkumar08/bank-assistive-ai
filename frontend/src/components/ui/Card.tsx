import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Needed when a control points at this card with aria-controls. */
  id?: string;
}

export function Card({ children, className, id }: CardProps) {
  return (
    <div
      id={id}
      className={cn(
        'rounded-2xl border border-ink-200/70 bg-white p-5',
        'shadow-[0_1px_2px_rgb(16_24_40/0.04),0_4px_12px_-4px_rgb(16_24_40/0.06)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

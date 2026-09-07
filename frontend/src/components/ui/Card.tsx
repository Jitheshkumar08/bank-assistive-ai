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
    <div id={id} className={cn('rounded-2xl border border-ink-200 bg-white p-5 shadow-sm', className)}>
      {children}
    </div>
  );
}

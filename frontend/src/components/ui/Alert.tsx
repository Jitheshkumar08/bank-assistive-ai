import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'error' | 'info' | 'success';

interface AlertProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const TONES: Record<Tone, string> = {
  error: 'bg-danger-50 text-danger-700 border-danger-500/30',
  info: 'bg-brand-50 text-brand-800 border-brand-500/30',
  success: 'bg-success-50 text-success-600 border-success-600/30',
};

export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  return (
    <div
      // Errors interrupt; everything else waits for a pause.
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-xl border px-4 py-3 text-sm', TONES[tone], className)}
    >
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Fills the container. The default on mobile, where buttons are thumb targets. */
  fullWidth?: boolean;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-white text-brand-700 border border-ink-200 hover:bg-brand-50 active:bg-brand-100',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50 active:bg-brand-100',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
};

export function Button({
  variant = 'primary',
  fullWidth = true,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      // min-h-touch keeps every button at 48px, the smallest target that
      // stays reliable for someone standing in a queue holding a phone.
      className={cn(
        'inline-flex min-h-touch items-center justify-center gap-2 rounded-xl px-5',
        'text-base font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="size-5" label={null} />}
      {children}
    </button>
  );
}

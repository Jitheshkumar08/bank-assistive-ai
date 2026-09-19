import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse' | 'overlay';
export type ButtonSize = 'md' | 'lg';

/**
 * How anything button-shaped looks, shared by <Button> and <LinkButton>
 * so an action and a navigation read as the same kind of control.
 *
 * `lg` is the default and keeps the 48px touch target the app is built
 * around -- this is used standing up, holding a phone. `md` is for dense
 * chrome, such as a page header on a wide screen.
 */
const BASE = cn(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-[-0.01em]',
  'transition-[background-color,box-shadow,color] duration-150',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(12_51_49/0.3)] hover:bg-brand-700 active:bg-brand-800',
  secondary:
    'bg-white text-ink-900 shadow-[0_1px_2px_rgb(16_24_40/0.05)] ring-1 ring-ink-200 ring-inset hover:bg-ink-50 hover:ring-ink-300 active:bg-ink-100',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
  danger:
    'bg-danger-600 text-white shadow-[0_1px_2px_rgb(133_41_31/0.3)] hover:bg-danger-700 active:bg-danger-700',
  // For use on a dark surface.
  inverse: 'bg-white text-ink-900 hover:bg-ink-100 active:bg-ink-200',
  // The quieter partner to inverse on a dark surface. Its focus ring is
  // white, because the brand ring all but vanishes against the dark.
  overlay:
    'bg-white/10 text-white ring-1 ring-white/20 ring-inset hover:bg-white/15 focus-visible:outline-white active:bg-white/20',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  lg: 'min-h-touch px-5 text-base',
};

export function buttonClasses({
  variant = 'primary',
  size = 'lg',
  fullWidth = true,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full');
}

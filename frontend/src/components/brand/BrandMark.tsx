import { cn } from '@/lib/cn';

type BrandMarkSize = 'sm' | 'md' | 'lg' | 'xl';

const TILE: Record<BrandMarkSize, string> = {
  sm: 'size-8 rounded-[0.6rem]',
  md: 'size-10 rounded-xl',
  lg: 'size-12 rounded-[0.9rem]',
  xl: 'size-[4.5rem] rounded-[1.35rem]',
};

const GLYPH: Record<BrandMarkSize, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-9',
};

interface BrandMarkProps {
  size?: BrandMarkSize;
  /** A deeper, softer shadow, for a mark shown on its own -- as in a hero. */
  elevated?: boolean;
  className?: string;
}

/**
 * The product mark: a speech bubble holding three rising steps -- a
 * conversation that moves you forward.
 *
 * Sizes and the elevated shadow are props rather than classes a caller
 * passes in: cn() joins classes without merging them, so a second size
 * or shadow would be settled by stylesheet order.
 *
 * Decorative wherever it appears. The product name always sits beside it
 * as real text, so it is hidden from assistive technology.
 */
export function BrandMark({ size = 'md', elevated = false, className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-white',
        'bg-linear-to-br from-brand-400 via-brand-500 to-brand-700 ring-1 ring-white/20 ring-inset',
        elevated
          ? 'shadow-[0_18px_40px_-12px_rgb(15_95_90/0.55),inset_0_1px_0_rgb(255_255_255/0.25)]'
          : 'shadow-[0_1px_2px_rgb(12_51_49/0.25)]',
        TILE[size],
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className={GLYPH[size]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h-.5A2.5 2.5 0 0 1 4 13.5z" />
        <path d="M9 12.5V11M12 12.5V9M15 12.5V7" />
      </svg>
    </span>
  );
}

import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Guidance shown before the user makes a mistake. */
  hint?: ReactNode;
  error?: string;
  /**
   * Content sat inside the input's right edge -- a show-password toggle,
   * for instance. The input is padded so typed text never runs under it.
   */
  trailing?: ReactNode;
}

/**
 * A labelled text input, styled the same in every form in the app.
 */
export function Field({ label, hint, error, className, required, trailing, ...props }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // Both are announced, so a screen reader hears the guidance and the
  // failure rather than just the label.
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  const input = (
    <input
      id={id}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      className={cn(
        'min-h-touch w-full rounded-xl border bg-white px-4 text-base text-ink-900',
        'shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-[border-color,box-shadow] duration-150',
        'placeholder:text-ink-400 disabled:bg-ink-50 disabled:text-ink-500',
        // The ring stands in for the global offset outline. The border
        // darkens with it, so focus stays plainly visible rather than a
        // faint glow.
        'focus-visible:outline-none focus:ring-4',
        error
          ? 'border-danger-500 focus:border-danger-600 focus:ring-danger-500/20'
          : 'border-ink-200 hover:border-ink-300 focus:border-brand-600 focus:ring-brand-500/25',
        trailing ? 'pr-12' : null,
        className,
      )}
      {...props}
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-800">
        {label}
        {required && (
          <span className="ml-1 text-danger-600" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-sm text-ink-600">
          {hint}
        </p>
      )}

      {trailing ? (
        <div className="relative">
          {input}
          <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>
        </div>
      ) : (
        input
      )}

      {error && (
        <p id={errorId} className="text-sm font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

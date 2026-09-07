import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Guidance shown before the user makes a mistake. */
  hint?: ReactNode;
  error?: string;
}

export function Field({ label, hint, error, className, required, ...props }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // Both are announced, so a screen reader hears the guidance and the
  // failure rather than just the label.
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-800">
        {label}
        {required && (
          <span className="ml-1 text-danger-600" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-sm text-ink-500">
          {hint}
        </p>
      )}

      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'min-h-touch w-full rounded-xl border bg-white px-4 text-base text-ink-900',
          'placeholder:text-ink-400',
          error ? 'border-danger-500' : 'border-ink-300',
          className,
        )}
        {...props}
      />

      {error && (
        <p id={errorId} className="text-sm font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

import { useEffect, type ReactNode } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { ButtonVariant } from '@/components/ui/buttonStyles';

interface ConfirmDialogProps {
  /** Tied to aria-labelledby, so the dialog is named by its own heading. */
  titleId: string;
  title: string;
  /** What exactly will happen, named in full. */
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  busy: boolean;
  /** The server's own refusal, shown without being paraphrased. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The ask before something irreversible.
 *
 * Every destructive action on the testing dashboard goes through this
 * one component, so none of them can quietly skip the question, and the
 * cancel always comes first in reading order -- the dangerous button is
 * never the one under a thumb that is already moving. It also holds the
 * initial focus, and Escape takes the same way out, so the quickest
 * reflex in either direction is the safe one.
 *
 * Escape is ignored while a write is in flight: the request has already
 * left, and closing the dialog then would hide its outcome.
 */
export function ConfirmDialog({
  titleId,
  title,
  children,
  confirmLabel,
  confirmVariant = 'danger',
  cancelLabel = 'Keep it',
  busy,
  error,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onCancel();
    }

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const dangerous = confirmVariant === 'danger';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-[0_24px_48px_-12px_rgb(16_24_40/0.25)] ring-1 ring-ink-900/5 sm:p-6"
      >
        <div className="flex gap-3.5">
          {/*
            Decorative: the heading already says which way this goes.
            It is here so the shape of the question registers before
            the sentence does.
          */}
          <span
            aria-hidden="true"
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full ring-1',
              dangerous
                ? 'bg-danger-50 text-danger-600 ring-danger-500/20'
                : 'bg-brand-50 text-brand-600 ring-brand-500/20',
            )}
          >
            {dangerous ? <WarningGlyph /> : <RestoreGlyph />}
          </span>

          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-[-0.01em] text-ink-900 sm:text-lg"
            >
              {title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{children}</p>
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <div className="mt-5 flex gap-2.5 border-t border-ink-100 pt-4">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
            // The safe way out holds the focus, so Enter cannot
            // complete an action nobody has read yet.
            autoFocus
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            size="md"
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WarningGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5">
      <path
        d="M12 9v4m0 3.5v.5M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5">
      <path
        d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import { cn } from '@/lib/cn';

/**
 * Illustrations of the product, drawn from what it actually does: the
 * code that starts a visit, a real step from the deposit workflow, the
 * tasks the engine guides, and the three languages it speaks.
 *
 * Decoration only. Wherever they are placed, the container hides them
 * from assistive technology -- read aloud, they would sound like a visit
 * already under way.
 */

interface CardProps {
  className?: string;
}

/** A white surface lifted off the canvas. */
const SURFACE =
  'rounded-2xl bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04),0_18px_40px_-18px_rgb(16_24_40/0.24)] ring-1 ring-ink-200/60';

export function NoteCard({ className }: CardProps) {
  return (
    <div
      className={cn(
        'relative w-56 rounded-md bg-amber-100 px-5 pt-7 pb-5',
        'shadow-[0_18px_36px_-18px_rgb(120_83_9/0.5)] ring-1 ring-amber-200/80',
        className,
      )}
    >
      <span className="absolute top-2.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-rose-500 shadow-[0_1px_2px_rgb(0_0_0/0.3)]" />
      <p className="text-[0.95rem] leading-snug font-medium text-amber-950/80">
        Scan the code at your counter, and your guide knows which branch you are in.
      </p>
    </div>
  );
}

export function CheckTile({ className }: CardProps) {
  return (
    <div
      className={cn(
        'flex size-14 items-center justify-center rounded-2xl bg-white',
        'shadow-[0_12px_28px_-12px_rgb(16_24_40/0.32)] ring-1 ring-ink-200/60',
        className,
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]">
        <svg
          className="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      </span>
    </div>
  );
}

export function StepCard({ className }: CardProps) {
  return (
    <div className={cn(SURFACE, 'w-64 p-4', className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-900">Current step</p>
        <span className="rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
          Deposit
        </span>
      </div>

      <div className="mt-3 rounded-xl bg-ink-50 p-3 ring-1 ring-ink-200/60">
        <p className="text-sm font-medium text-ink-900">Fill in your account number</p>
        <p className="mt-0.5 text-xs text-ink-500">Read aloud in English</p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
          <svg
            className="size-3"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 11V9.5M8 11V7M12 11V4.5" />
          </svg>
          Step 2
        </span>
      </div>
    </div>
  );
}

export function MicTile({ className }: CardProps) {
  return (
    <div
      className={cn(
        'flex size-16 items-center justify-center rounded-2xl bg-white',
        'shadow-[0_14px_30px_-14px_rgb(16_24_40/0.36)] ring-1 ring-ink-200/60',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-ink-900 text-white">
        <svg
          className="size-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </span>
    </div>
  );
}

const TASKS = [
  { name: 'Deposit money', progress: 64, bar: 'bg-brand-500' },
  { name: 'Apply for a loan', progress: 38, bar: 'bg-amber-400' },
] as const;

export function TasksCard({ className }: CardProps) {
  return (
    <div className={cn(SURFACE, 'w-72 p-4', className)}>
      <p className="text-sm font-semibold text-ink-900">Guided tasks</p>
      <ul className="mt-3 space-y-2.5">
        {TASKS.map((task) => (
          <li key={task.name} className="rounded-xl bg-ink-50 p-3 ring-1 ring-ink-200/60">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink-800">{task.name}</span>
              <span className="text-ink-500">{task.progress}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-ink-200/70">
              <div className={cn('h-full rounded-full', task.bar)} style={{ width: `${task.progress}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LANGUAGE_TILES = [
  { glyph: 'En', label: 'English', lang: 'en', tile: 'bg-ink-900 text-white' },
  { glyph: 'ಕ', label: 'ಕನ್ನಡ', lang: 'kn', tile: 'bg-brand-600 text-white' },
  { glyph: 'हि', label: 'हिन्दी', lang: 'hi', tile: 'bg-amber-400 text-amber-950' },
] as const;

export function LanguagesCard({ className }: CardProps) {
  return (
    <div className={cn(SURFACE, 'w-64 p-4', className)}>
      <p className="text-sm font-semibold text-ink-900">Speaks your language</p>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {LANGUAGE_TILES.map((language) => (
          <li key={language.lang} className="flex flex-col items-center gap-1.5">
            <span
              lang={language.lang}
              className={cn(
                'flex size-12 items-center justify-center rounded-xl text-lg font-semibold',
                'shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_6px_14px_-6px_rgb(16_24_40/0.35)]',
                language.tile,
              )}
            >
              {language.glyph}
            </span>
            <span lang={language.lang} className="text-xs text-ink-600">
              {language.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

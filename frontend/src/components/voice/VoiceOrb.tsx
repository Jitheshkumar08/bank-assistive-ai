import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export type OrbState = 'off' | 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

const ORB_LABEL: Record<OrbState, string> = {
  off: 'Voice is off',
  idle: 'Assistant ready',
  listening: 'Assistant listening',
  processing: 'Assistant working',
  speaking: 'Assistant speaking',
  error: 'Microphone problem',
};

interface VoiceOrbProps {
  state: OrbState;
  /** dBFS while listening; drives the ring. Absent or null: a still ring. */
  readLevel?: () => number | null;
  size?: 'compact' | 'hero';
  className?: string;
}

/** dBFS -> 0..1 over the range a voice near a phone actually spans. */
export function levelToScale(db: number | null): number {
  if (db === null || !Number.isFinite(db)) return 1;
  const normalised = Math.min(1, Math.max(0, (db + 60) / 45));
  return 1 + normalised * 0.3;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * The assistant, as one calm shape that shows what it is doing.
 *
 * Every state comes from the voice session itself -- the orb never shows
 * activity that is not happening. While listening, the ring follows the
 * level the microphone is actually measuring; with no measurement it stays
 * still rather than pretending. Reduced motion turns every animation off,
 * including the level ring.
 */
export function VoiceOrb({ state, readLevel, size = 'hero', className }: VoiceOrbProps) {
  const ringRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;

    ring.style.setProperty('--orb-level', '1');

    if (state !== 'listening' || !readLevel || prefersReducedMotion()) return;
    if (typeof window.requestAnimationFrame !== 'function') return;

    let frame = window.requestAnimationFrame(function tick() {
      ring.style.setProperty('--orb-level', String(levelToScale(readLevel())));
      frame = window.requestAnimationFrame(tick);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      ring.style.setProperty('--orb-level', '1');
    };
  }, [state, readLevel]);

  const hero = size === 'hero';

  return (
    <div
      role="img"
      aria-label={ORB_LABEL[state]}
      data-state={state}
      className={cn(
        'relative grid shrink-0 place-items-center',
        hero ? 'size-36 sm:size-40' : 'size-14',
        className,
      )}
    >
      {/* Listening: a ring that follows the measured level. */}
      <span
        ref={ringRef}
        aria-hidden="true"
        className={cn(
          'absolute inset-0 rounded-full transition-[transform,opacity] duration-100 ease-out',
          '[transform:scale(var(--orb-level,1))] motion-reduce:transition-none',
          state === 'listening' ? 'bg-danger-500/15 opacity-100' : 'opacity-0',
        )}
      />

      {/* Working: a slow arc. */}
      {state === 'processing' && (
        <span
          aria-hidden="true"
          data-orb-part="arc"
          className={cn(
            'absolute rounded-full border-brand-100 border-t-brand-500 animate-spin motion-reduce:animate-none',
            hero ? 'inset-3 border-4' : 'inset-0.5 border-2',
          )}
        />
      )}

      {/* Speaking: a gentle breath. */}
      {state === 'speaking' && (
        <span
          aria-hidden="true"
          data-orb-part="breath"
          className="absolute inset-1 animate-pulse rounded-full bg-brand-500/20 motion-reduce:animate-none"
        />
      )}

      <span
        aria-hidden="true"
        className={cn(
          'relative flex items-center justify-center rounded-full text-white',
          'shadow-[0_12px_28px_-10px_rgb(12_51_49/0.55),inset_0_1px_0_rgb(255_255_255/0.18)]',
          'transition-colors duration-200',
          hero ? 'size-24 sm:size-28' : 'size-10',
          state === 'off' && 'bg-ink-300',
          state === 'idle' && 'bg-brand-600',
          state === 'listening' && 'bg-danger-600',
          (state === 'processing' || state === 'speaking') && 'bg-brand-700',
          state === 'error' && 'bg-danger-700',
        )}
      >
        <OrbGlyph state={state} className={hero ? 'size-9' : 'size-5'} />
      </span>
    </div>
  );
}

function OrbGlyph({ state, className }: { state: OrbState; className: string }) {
  if (state === 'speaking') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
      </svg>
    );
  }

  if (state === 'error') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 7v6M12 17h.01" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

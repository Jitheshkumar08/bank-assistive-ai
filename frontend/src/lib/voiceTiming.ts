import type { EndpointingConfig } from '@/lib/speechDetector';

/**
 * The branch's hands-free voice timings, in one place.
 *
 *   relisten gap   3 s  after the assistant finishes speaking -- a reply, an
 *                       offer of help, the answer to something typed -- the
 *                       microphone reopens by itself after this pause
 *   end silence    3 s  once the customer has spoken, this much silence ends
 *                       their turn and submits it
 *
 * The voice library's own defaults (RELISTEN_DELAY_MS, DEFAULT_ENDPOINTING)
 * stay as they are -- they mirror the engine's CLI recorder and their tests
 * check that. The app passes these instead (routes/RootLayout). The CLI's
 * 800 ms end silence submitted half a request whenever a customer paused to
 * read an account number or think; three seconds lets them finish.
 *
 * A deployment can change either with VITE_VOICE_RELISTEN_DELAY_MS or
 * VITE_VOICE_END_SILENCE_MS. Values outside a sensible range are ignored
 * rather than trusted, as with VITE_ASSISTANCE_INACTIVITY_MS.
 */
export const DEFAULT_VOICE_RELISTEN_DELAY_MS = 3_000;
export const DEFAULT_VOICE_END_SILENCE_MS = 3_000;

const RELISTEN_RANGE = { min: 300, max: 10_000 } as const;
const END_SILENCE_RANGE = { min: 800, max: 6_000 } as const;

function resolveMs(
  configured: unknown,
  fallback: number,
  range: { min: number; max: number },
): number {
  const value = typeof configured === 'string' ? Number(configured.trim()) : configured;

  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < range.min || value > range.max) return fallback;

  return Math.round(value);
}

export function resolveRelistenDelayMs(configured: unknown): number {
  return resolveMs(configured, DEFAULT_VOICE_RELISTEN_DELAY_MS, RELISTEN_RANGE);
}

export function resolveEndSilenceMs(configured: unknown): number {
  return resolveMs(configured, DEFAULT_VOICE_END_SILENCE_MS, END_SILENCE_RANGE);
}

export const VOICE_RELISTEN_DELAY_MS = resolveRelistenDelayMs(
  import.meta.env.VITE_VOICE_RELISTEN_DELAY_MS,
);

export const VOICE_ENDPOINTING: Readonly<Partial<EndpointingConfig>> = Object.freeze({
  endSilenceMs: resolveEndSilenceMs(import.meta.env.VITE_VOICE_END_SILENCE_MS),
});

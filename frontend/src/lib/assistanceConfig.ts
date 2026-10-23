/**
 * How long a customer may be quiet on a step before help is offered.
 *
 * The one place this is set. Twelve seconds by default; a deployment can
 * change it with VITE_ASSISTANCE_INACTIVITY_MS. Values outside a sensible
 * range are ignored rather than trusted: an offer every second would nag,
 * and one after ten minutes would never come.
 */
export const DEFAULT_INACTIVITY_MS = 12_000;

const MIN_INACTIVITY_MS = 5_000;
const MAX_INACTIVITY_MS = 120_000;

export function resolveInactivityMs(configured: unknown): number {
  const value = typeof configured === 'string' ? Number(configured.trim()) : configured;

  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_INACTIVITY_MS;
  if (value < MIN_INACTIVITY_MS || value > MAX_INACTIVITY_MS) return DEFAULT_INACTIVITY_MS;

  return Math.round(value);
}

export const ASSISTANCE_INACTIVITY_MS = resolveInactivityMs(
  import.meta.env.VITE_ASSISTANCE_INACTIVITY_MS,
);

import type { QrPayload } from '@/types/context';

const CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Reads a scanned QR code.
 *
 * The contents of a QR code are untrusted input -- anyone can print one
 * and stick it to a wall. So this extracts exactly one field and
 * ignores everything else in the payload. A code carrying extra
 * instructions, a different destination, or any other data cannot
 * influence the app: the code it yields is then validated by the API
 * against real branches before anything happens.
 *
 * Ignoring unknown fields is also what keeps already-printed codes
 * working. Earlier codes carried an `area_id` alongside the branch;
 * those still scan, and the extra field is simply dropped.
 */
export function parseQrPayload(raw: string): QrPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const { branch_id: branchId } = parsed as Record<string, unknown>;

  if (typeof branchId !== 'string') {
    return null;
  }

  if (!CODE_PATTERN.test(branchId)) {
    return null;
  }

  return { branch_id: branchId };
}

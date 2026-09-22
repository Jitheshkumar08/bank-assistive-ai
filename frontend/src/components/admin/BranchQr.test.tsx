import { describe, expect, it } from 'vitest';
import { branchQrPayload } from './BranchQr';
import { parseQrPayload } from '@/lib/qr';

/**
 * What goes inside a printed QR code.
 *
 * This is the contract between the admin screen that prints a code and
 * the scan screen that reads one, so it is pinned exactly: a QR code
 * establishes which branch the customer is in, and carries nothing else
 * -- no workflow, no instruction, no assistant behaviour.
 */
describe('branchQrPayload', () => {
  it('contains the branch code and nothing else', () => {
    expect(branchQrPayload('BR001')).toBe('{"branch_id":"BR001"}');
    expect(Object.keys(JSON.parse(branchQrPayload('BR001')))).toEqual(['branch_id']);
  });

  it('produces a code the scanner in this app accepts', () => {
    expect(parseQrPayload(branchQrPayload('BR001'))).toEqual({ branch_id: 'BR001' });
  });
});

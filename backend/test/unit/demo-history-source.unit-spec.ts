import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DemoHistorySource } from '../../src/suggestions/history/demo-history.source';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * The gate on demonstration data.
 *
 * DEMO_HISTORY_ENABLED is the only thing standing between seeded
 * demonstration rows and a customer being told "you usually pay Rahul".
 * It must be false unless something explicitly says the single word
 * "true", because every other value -- unset, empty, "False", "0",
 * "no" -- is somebody intending it to be off.
 */

function source(value: string | undefined, nodeEnv = 'development') {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { demoPaymentHistory: { findMany } } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : value),
  } as unknown as ConfigService;

  return { instance: new DemoHistorySource(prisma, config), findMany };
}

describe('DemoHistorySource', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('reads demonstration history when explicitly enabled', async () => {
    const { instance, findMany } = source('true');

    await instance.paymentsFor('user-1', new Date(0));

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('announces itself in the log when enabled', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    source('true');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DEMO_HISTORY_ENABLED=true'));
  });

  it.each([undefined, '', 'false', 'False', 'TRUE', '1', 'yes'])(
    'reads nothing, and does not even query, when the flag is %p',
    async (value) => {
      const { instance, findMany } = source(value);

      await expect(instance.paymentsFor('user-1', new Date(0))).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('refuses to read demonstration history in production, flag or no flag', async () => {
    // A single stray environment variable must not be all that stands
    // between invented history and a real customer.
    const { instance, findMany } = source('true', 'production');

    await expect(instance.paymentsFor('user-1', new Date(0))).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('says plainly in the log that production refused it', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    source('true', 'production');

    expect(error).toHaveBeenCalledWith(expect.stringContaining('REFUSED'));
  });

  it('asks the database for completed payments only', async () => {
    // The filter is asserted on the QUERY, not on the result. A test
    // that only checked the returned rows would still pass if the
    // where-clause were dropped and the database happened to hold
    // nothing but completed rows -- which is exactly the state this
    // project is in, so that test would never fail.
    const { instance, findMany } = source('true');
    const since = new Date('2026-05-20T00:00:00Z');

    await instance.paymentsFor('user-1', since);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', occurredAt: { gte: since }, status: 'COMPLETED' },
      select: { payeeId: true, amountMinor: true, occurredAt: true },
    });
  });

  it('never asks for a failed or pending payment', async () => {
    const { instance, findMany } = source('true');

    await instance.paymentsFor('user-1', new Date(0));

    const where = findMany.mock.calls[0][0].where;

    expect(where.status).toBe('COMPLETED');
    // Not "not FAILED", not a list: exactly the one status that means
    // the payment happened. A new status added later is excluded by
    // default rather than quietly becoming evidence of a habit.
    expect(JSON.stringify(where)).not.toContain('FAILED');
    expect(JSON.stringify(where)).not.toContain('PENDING');
  });

  it('stamps every item as demonstration data', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { payeeId: 'payee-1', amountMinor: 500_000, occurredAt: new Date('2026-10-16T12:00:00Z') },
    ]);
    const prisma = { demoPaymentHistory: { findMany } } as unknown as PrismaService;
    const config = {
      get: (key: string) => (key === 'NODE_ENV' ? 'development' : 'true'),
    } as unknown as ConfigService;

    const items = await new DemoHistorySource(prisma, config).paymentsFor('u', new Date(0));

    expect(items).toEqual([
      expect.objectContaining({ payeeId: 'payee-1', provenance: 'DEMO_HISTORY' }),
    ]);
  });
});

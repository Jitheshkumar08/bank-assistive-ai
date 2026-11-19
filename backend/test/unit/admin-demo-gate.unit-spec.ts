import { Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AdminDemoService } from '../../src/admin-demo/admin-demo.service';
import { AdminDemoModule } from '../../src/admin-demo/admin-demo.module';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SuggestionsService } from '../../src/suggestions/suggestions.service';

/**
 * The four conditions on demo management.
 *
 * NODE_ENV cannot be changed inside a booted application, so the
 * production refusal is proved here rather than end to end. All four
 * must hold: a non-production environment, DEMO_DASHBOARD_ENABLED,
 * DEMO_HISTORY_ENABLED, and -- enforced by @Roles on the controller and
 * covered by the e2e suite -- an authenticated ADMIN.
 *
 * Any one of them missing and the dashboard answers as though it does
 * not exist, which is what production answers by never registering it.
 */

interface Flags {
  nodeEnv?: string;
  dashboard?: string;
  history?: string;
}

function service(flags: Flags) {
  const findMany = jest.fn().mockResolvedValue([]);
  const groupBy = jest.fn().mockResolvedValue([]);
  // Every write path, so a refusal can be shown to reach none of them.
  const create = jest.fn();
  const update = jest.fn();
  const remove = jest.fn();
  const removeMany = jest.fn();
  const createMany = jest.fn();
  const transaction = jest.fn();

  const prisma = {
    $transaction: transaction,
    user: { findMany, findFirst: jest.fn() },
    payee: {
      groupBy,
      findMany,
      findFirst: jest.fn(),
      count: jest.fn(),
      create,
      deleteMany: removeMany,
    },
    demoPaymentHistory: {
      groupBy,
      findMany,
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      create,
      createMany,
      update,
      delete: remove,
      deleteMany: removeMany,
    },
  } as unknown as PrismaService;

  const evaluate = jest.fn();
  const suggestions = { evaluate } as unknown as SuggestionsService;

  const config = {
    get: (key: string) => {
      if (key === 'NODE_ENV') return flags.nodeEnv ?? 'development';
      if (key === 'DEMO_DASHBOARD_ENABLED') return flags.dashboard;
      if (key === 'DEMO_HISTORY_ENABLED') return flags.history;
      if (key === 'SUGGESTIONS_ENABLED') return 'true';
      return undefined;
    },
  } as unknown as ConfigService;

  return {
    instance: new AdminDemoService(prisma, suggestions, config),
    findMany,
    evaluate,
    create,
    update,
    remove,
    removeMany,
    createMany,
    transaction,
  };
}

/** A body that would be perfectly valid were the dashboard available. */
const VALID_WRITE = {
  payeeId: '11111111-1111-4111-8111-111111111111',
  amountMinor: 250_000,
  occurredAt: new Date().toISOString(),
  status: 'COMPLETED' as const,
};

const ON = { dashboard: 'true', history: 'true' };

describe('AdminDemoService availability', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('serves the dashboard when all three environment conditions hold', async () => {
    const { instance } = service(ON);

    await expect(instance.listCustomers()).resolves.toEqual([]);
  });

  it('announces itself in the log when switched on', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service(ON);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DEMO_DASHBOARD_ENABLED=true'));
  });

  it('REFUSES in production, flag or no flag', async () => {
    const { instance, findMany } = service({ ...ON, nodeEnv: 'production' });

    await expect(instance.listCustomers()).rejects.toThrow(NotFoundException);
    await expect(instance.preview('user-1', undefined)).rejects.toThrow(NotFoundException);
    await expect(instance.listPayments('user-1', undefined)).rejects.toThrow(NotFoundException);

    // Not merely refused at the edge: it never reaches the database.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('says plainly in the log that production refused it', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    service({ ...ON, nodeEnv: 'production' });

    expect(error).toHaveBeenCalledWith(expect.stringContaining('REFUSED'));
  });

  it.each([undefined, '', 'false', 'False', 'TRUE', '1', 'yes'])(
    'is unavailable when DEMO_DASHBOARD_ENABLED is %p',
    async (dashboard) => {
      const { instance, findMany } = service({ dashboard, history: 'true' });

      await expect(instance.listCustomers()).rejects.toThrow(NotFoundException);
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('is unavailable when demo history itself may not be read', async () => {
    // Managing history that no suggestion is allowed to read would only
    // mislead: the preview would always be empty.
    const { instance } = service({ dashboard: 'true', history: 'false' });

    await expect(instance.listCustomers()).rejects.toThrow(NotFoundException);
  });

  it('explains that combination in the log rather than failing silently', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service({ dashboard: 'true', history: 'false' });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DEMO_HISTORY_ENABLED'));
  });

  it('never consults the suggestion engine while unavailable', async () => {
    const { instance, evaluate } = service({ dashboard: 'false', history: 'true' });

    await expect(instance.preview('user-1', undefined)).rejects.toThrow(NotFoundException);
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('AdminDemoService writes are gated too', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('REFUSES every write in production, and writes nothing', async () => {
    const { instance, create, update, remove } = service({ ...ON, nodeEnv: 'production' });

    await expect(instance.createPayment('user-1', VALID_WRITE)).rejects.toThrow(NotFoundException);
    await expect(
      instance.updatePayment('user-1', 'payment-1', { status: 'FAILED' }),
    ).rejects.toThrow(NotFoundException);
    await expect(instance.deletePayment('user-1', 'payment-1')).rejects.toThrow(NotFoundException);

    // Not merely refused at the edge: nothing reached the database.
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([undefined, 'false', 'TRUE', '1'])(
    'refuses every write when DEMO_DASHBOARD_ENABLED is %p',
    async (dashboard) => {
      const { instance, create, update, remove } = service({ dashboard, history: 'true' });

      await expect(instance.createPayment('user-1', VALID_WRITE)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        instance.updatePayment('user-1', 'payment-1', { status: 'FAILED' }),
      ).rejects.toThrow(NotFoundException);
      await expect(instance.deletePayment('user-1', 'payment-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it('refuses every write when demo history itself may not be read', async () => {
    const { instance, create } = service({ dashboard: 'true', history: 'false' });

    await expect(instance.createPayment('user-1', VALID_WRITE)).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * The amount rules, enforced by the SERVICE rather than the pipe.
 *
 * The DTO rejects a bad amount first in ordinary use, so these tests
 * reach past it deliberately: the service is the thing that must still
 * be correct if it is ever called from somewhere other than an HTTP
 * request. Two layers, each proven on its own.
 */
describe('AdminDemoService amount rules, independent of the validation pipe', () => {
  function available() {
    const create = jest.fn();
    const customer = { id: 'user-1', email: 'c@example.local', role: 'CUSTOMER' };

    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(customer), findMany: jest.fn() },
      payee: { findFirst: jest.fn(), create, groupBy: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      demoPaymentHistory: {
        create,
        update: jest.fn(),
        delete: jest.fn(),
        // An existing row, so the edit path reaches the amount rules
        // instead of stopping at "no such payment".
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          userId: 'user-1',
          payeeId: 'payee-1',
          amountMinor: 250_000,
          currency: 'INR',
          status: 'COMPLETED',
          occurredAt: new Date(),
          createdAt: new Date(),
          payee: {
            id: 'payee-1',
            userId: 'user-1',
            displayName: 'Meera',
            fullName: null,
            accountLast4: '1234',
            trust: 'DEMO_SEEDED',
          },
        }),
        findMany: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
    } as unknown as PrismaService;

    const config = {
      get: (key: string, fallback?: unknown) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'DEMO_DASHBOARD_ENABLED') return 'true';
        if (key === 'DEMO_HISTORY_ENABLED') return 'true';
        if (key === 'SUGGESTIONS_ENABLED') return 'true';
        if (key === 'ACTIVITY_MAX_AMOUNT_MINOR') return 1_000_000;
        return fallback;
      },
    } as unknown as ConfigService;

    const suggestions = { evaluate: jest.fn() } as unknown as SuggestionsService;

    return { instance: new AdminDemoService(prisma, suggestions, config), create };
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // The MESSAGE is asserted, not merely the exception class. Several
  // different refusals on this path are 422s, so a class-only
  // assertion would be satisfied by the wrong rule firing -- which is
  // exactly what a mutation of the amount check produces.
  it.each([4999, 101, 250_050, 999, 1])(
    'refuses %p paise because it is not a whole rupee',
    async (amountMinor) => {
      const { instance, create } = available();

      await expect(
        instance.createPayment('user-1', { ...VALID_WRITE, amountMinor }),
      ).rejects.toThrow(/whole number of rupees|at least ₹1/);

      expect(create).not.toHaveBeenCalled();
    },
  );

  it('refuses a fractional rupee on an edit as well', async () => {
    const { instance } = available();

    await expect(
      instance.updatePayment('user-1', 'payment-1', { amountMinor: 4999 }),
    ).rejects.toThrow(/whole number of rupees/);
  });

  it('refuses an amount above the ceiling, in whole rupees', async () => {
    const { instance, create } = available();

    await expect(
      instance.createPayment('user-1', { ...VALID_WRITE, amountMinor: 1_000_100 }),
    ).rejects.toThrow(/at most/);

    expect(create).not.toHaveBeenCalled();
  });

  it('refuses less than a rupee', async () => {
    const { instance } = available();

    await expect(
      instance.createPayment('user-1', { ...VALID_WRITE, amountMinor: 0 }),
    ).rejects.toThrow(/at least ₹1/);
  });

  it('gets past the amount rules on a whole rupee within the ceiling', async () => {
    const { instance } = available();

    // It fails later, on the payee lookup -- which proves the amount
    // itself was accepted rather than the call being refused early.
    await expect(
      instance.createPayment('user-1', { ...VALID_WRITE, amountMinor: 250_000 }),
    ).rejects.toThrow(/not a demonstration beneficiary/i);
  });
});

describe('AdminDemoModule registration', () => {
  const original = process.env.NODE_ENV;

  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));

  afterEach(() => {
    process.env.NODE_ENV = original;
    jest.restoreAllMocks();
  });

  it('contributes NO controller and NO provider in production', () => {
    process.env.NODE_ENV = 'production';

    const registered = AdminDemoModule.register();

    // Nothing to route means the path does not exist, rather than
    // existing and returning 403 -- which would confirm the feature.
    expect(registered.controllers).toBeUndefined();
    expect(registered.providers).toBeUndefined();
    expect(registered.imports).toBeUndefined();
  });

  it('registers the controller outside production', () => {
    process.env.NODE_ENV = 'development';

    const registered = AdminDemoModule.register();

    expect(registered.controllers).toHaveLength(1);
    expect(registered.providers).toHaveLength(1);
  });
});

/**
 * Clearing and restoring are the two actions that touch a customer's
 * whole history at once, so the gate matters most here: a reset that
 * slipped through in production would delete rows rather than merely
 * display them.
 */
describe('AdminDemoService clearing and restoring are gated too', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('REFUSES to clear in production, and DELETES NOTHING', async () => {
    const { instance, removeMany, transaction, findMany } = service({
      ...ON,
      nodeEnv: 'production',
    });

    await expect(instance.resetHistory('user-1')).rejects.toThrow(NotFoundException);

    // Not merely refused at the edge: no query, no transaction, no
    // delete ever reached the database.
    expect(findMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(removeMany).not.toHaveBeenCalled();
  });

  it('REFUSES to restore in production, and WRITES NOTHING', async () => {
    const { instance, create, createMany, removeMany, transaction } = service({
      ...ON,
      nodeEnv: 'production',
    });

    await expect(instance.restoreFixture('user-1')).rejects.toThrow(NotFoundException);

    expect(create).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(removeMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([undefined, 'false', 'TRUE', '1'])(
    'refuses both when DEMO_DASHBOARD_ENABLED is %p',
    async (dashboard) => {
      const { instance, removeMany, createMany, transaction } = service({
        dashboard,
        history: 'true',
      });

      await expect(instance.resetHistory('user-1')).rejects.toThrow(NotFoundException);
      await expect(instance.restoreFixture('user-1')).rejects.toThrow(NotFoundException);

      expect(removeMany).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('refuses both when demo history itself may not be read', async () => {
    const { instance, transaction } = service({ dashboard: 'true', history: 'false' });

    await expect(instance.resetHistory('user-1')).rejects.toThrow(NotFoundException);
    await expect(instance.restoreFixture('user-1')).rejects.toThrow(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses to clear an account that is not a customer', async () => {
    const { instance, transaction, removeMany } = service(ON);

    // loadCustomer() looks for role CUSTOMER and finds nothing.
    await expect(instance.resetHistory('admin-1')).rejects.toThrow(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
    expect(removeMany).not.toHaveBeenCalled();
  });

  it('refuses to restore onto an account that is not a customer', async () => {
    const { instance, create, createMany } = service(ON);

    await expect(instance.restoreFixture('admin-1')).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});

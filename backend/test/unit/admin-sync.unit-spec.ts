import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Role, type User } from '@prisma/client';
import { AuthService } from '../../src/auth/auth.service';
import { PasswordService } from '../../src/auth/password.service';
import type { UsersService } from '../../src/users/users.service';

/**
 * The boot-time ADMIN_EMAIL sync.
 *
 * It runs on every start, so it must write nothing when the account is
 * already right. Real argon2 is used throughout: the point is whether a
 * stored hash is recognised, and a fake verifier would only test itself.
 */

const EMAIL = 'admin@bank.test';
const PASSWORD = 'configured-admin-password';

function adminRow(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: EMAIL,
    fullName: 'Administrator',
    phone: null,
    passwordHash: '',
    preferredLanguage: 'en',
    isActive: true,
    role: Role.ADMIN,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(existing: User | null, env: Record<string, string> = { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASSWORD }) {
  const passwords = new PasswordService();
  const users = {
    findByEmailWithHash: jest.fn().mockResolvedValue(existing),
    upsertAdminUser: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn((key: string) => env[key]) };

  const service = new AuthService(
    users as unknown as UsersService,
    passwords,
    {} as JwtService,
    config as unknown as ConfigService,
  );

  // Counted after construction, so the decoy hash made by onModuleInit
  // is the only hash expected when the admin is already correct.
  const hash = jest.spyOn(passwords, 'hash');

  return { service, users, hash };
}

describe('admin account sync at boot', () => {
  let logs: jest.SpyInstance;

  beforeEach(() => {
    logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes nothing when the admin already matches the configuration', async () => {
    const stored = await new PasswordService().hash(PASSWORD);
    const { service, users, hash } = setup(adminRow({ passwordHash: stored }));

    await service.onModuleInit();

    expect(users.upsertAdminUser).not.toHaveBeenCalled();
    // Only the decoy: no new hash of the admin password was generated.
    expect(hash).toHaveBeenCalledTimes(1);
    expect(hash).not.toHaveBeenCalledWith(PASSWORD);
  });

  it('rehashes and saves when the configured password changed', async () => {
    const stored = await new PasswordService().hash('the-old-password');
    const { service, users, hash } = setup(adminRow({ passwordHash: stored }));

    await service.onModuleInit();

    expect(hash).toHaveBeenCalledWith(PASSWORD);
    expect(users.upsertAdminUser).toHaveBeenCalledTimes(1);

    const [email, newHash] = users.upsertAdminUser.mock.calls[0];
    expect(email).toBe(EMAIL);
    expect(newHash).not.toBe(stored);
    // The saved hash really is the configured password.
    await expect(new PasswordService().verify(newHash, PASSWORD)).resolves.toBe(true);
  });

  it('creates the admin when the account does not exist', async () => {
    const { service, users, hash } = setup(null);

    await service.onModuleInit();

    expect(hash).toHaveBeenCalledWith(PASSWORD);
    expect(users.upsertAdminUser).toHaveBeenCalledTimes(1);
    await expect(
      new PasswordService().verify(users.upsertAdminUser.mock.calls[0][1], PASSWORD),
    ).resolves.toBe(true);
  });

  it.each([
    ['is a customer', { role: Role.CUSTOMER }],
    ['is deactivated', { isActive: false }],
  ])('corrects an account that %s, keeping its matching password hash', async (_label, fault) => {
    const stored = await new PasswordService().hash(PASSWORD);
    const { service, users, hash } = setup(adminRow({ passwordHash: stored, ...fault }));

    await service.onModuleInit();

    // upsertAdminUser sets role ADMIN and isActive true on update.
    expect(users.upsertAdminUser).toHaveBeenCalledWith(EMAIL, stored, 'Administrator');
    expect(hash).not.toHaveBeenCalledWith(PASSWORD);
  });

  it('never treats an unverifiable stored hash as a match', async () => {
    const { service, users, hash } = setup(adminRow({ passwordHash: 'not-an-argon2-hash' }));

    await service.onModuleInit();

    expect(hash).toHaveBeenCalledWith(PASSWORD);
    expect(users.upsertAdminUser).toHaveBeenCalledTimes(1);
    expect(users.upsertAdminUser.mock.calls[0][1]).not.toBe('not-an-argon2-hash');
  });

  it('does nothing at all when ADMIN_EMAIL or ADMIN_PASSWORD is unset', async () => {
    const { service, users } = setup(null, { ADMIN_EMAIL: EMAIL });

    await service.onModuleInit();

    expect(users.findByEmailWithHash).not.toHaveBeenCalled();
    expect(users.upsertAdminUser).not.toHaveBeenCalled();
  });

  it('never logs the password or a hash', async () => {
    const stored = await new PasswordService().hash('the-old-password');
    const { service } = setup(adminRow({ passwordHash: stored }));

    await service.onModuleInit();

    const logged = logs.mock.calls.flat().join(' ');
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain('$argon2');
  });
});

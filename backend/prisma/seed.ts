import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { buildDemoFixture } from '../src/admin-demo/demo-fixture';

const prisma = new PrismaClient();

/**
 * Credentials for the local development account.
 *
 * This is seed data for a developer machine, not a real customer. It is
 * intentionally well-known so the team can sign in while building the
 * frontend, and it must never be seeded into a deployed environment.
 */
const DEMO_EMAIL = 'jeethu@gmail.com';
const DEMO_PASSWORD = 'jeethu@12345';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test@12345';

/**
 * Demonstration payment history for the local account.
 *
 * The fixture itself -- who, how much, and on which dates -- lives in
 * src/admin-demo/demo-fixture.ts, because the testing dashboard's
 * restore action has to write exactly the same thing. This function is
 * only the part that puts it in the database.
 *
 * It is NOT customer data and NOT a bank record, and it is only ever
 * read when DEMO_HISTORY_ENABLED is on.
 */
async function seedDemoPaymentHistory(userId: string): Promise<number> {
  // Re-runnable: the demonstration rows are rebuilt from scratch rather
  // than accumulating a new copy on every seed. Only DEMO_SEEDED payees
  // are touched, so anything a customer entered is left alone.
  await prisma.demoPaymentHistory.deleteMany({ where: { userId } });
  await prisma.payee.deleteMany({ where: { userId, trust: 'DEMO_SEEDED' } });

  const fixture = buildDemoFixture();
  const payeeIds = new Map<string, string>();

  for (const payee of fixture.payees) {
    const row = await prisma.payee.create({
      data: {
        userId,
        displayName: payee.displayName,
        fullName: payee.fullName,
        accountLast4: payee.accountLast4,
        trust: 'DEMO_SEEDED',
      },
    });

    payeeIds.set(payee.key, row.id);
  }

  await prisma.demoPaymentHistory.createMany({
    data: fixture.payments.map((payment) => {
      const payeeId = payeeIds.get(payment.payeeKey);

      if (!payeeId) {
        throw new Error(`Demo fixture refers to an unknown payee "${payment.payeeKey}".`);
      }

      return {
        userId,
        payeeId,
        amountMinor: payment.amountMinor,
        currency: 'INR',
        status: payment.status,
        occurredAt: payment.occurredAt,
      };
    }),
  });

  return fixture.payments.length;
}

async function main(): Promise<void> {
  // Every write is an upsert keyed on a natural unique column, so the
  // seed can be re-run safely without duplicating rows or resetting
  // anything that already exists.

  const passwordHash = await hash(DEMO_PASSWORD);

  // The hash is refreshed on every run, so a seed executed against a
  // database created before the authentication phase upgrades the
  // placeholder rather than leaving an account that cannot sign in.
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: {
      email: DEMO_EMAIL,
      fullName: 'Demo Customer',
      passwordHash,
      preferredLanguage: 'en',
    },
  });

  let adminUser = null;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const adminPasswordHash = await hash(ADMIN_PASSWORD);
    adminUser = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL.toLowerCase() },
      update: { passwordHash: adminPasswordHash, isActive: true, role: 'ADMIN' },
      create: {
        email: ADMIN_EMAIL.toLowerCase(),
        fullName: 'Administrator',
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        preferredLanguage: 'en',
      },
    });
  }

  await prisma.branch.upsert({
    where: { code: 'BR001' },
    update: {},
    create: {
      code: 'BR001',
      name: 'Surathkal Branch',
      city: 'Mangaluru',
      address: 'NITK Road, Surathkal',
    },
  });

  await prisma.branch.upsert({
    where: { code: 'BR002' },
    update: {},
    create: {
      code: 'BR002',
      name: 'Mangaluru City Branch',
      city: 'Mangaluru',
      address: 'Hampankatta',
    },
  });

  const demoPayments = await seedDemoPaymentHistory(demoUser.id);

  const counts = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    sessions: await prisma.session.count(),
  };

  console.log('Seed complete.');
  if (adminUser) {
    console.log(`  admin user: ${adminUser.email} / ${ADMIN_PASSWORD}`);
  }
  console.log(`  demo user : ${demoUser.email} / ${DEMO_PASSWORD}`);
  console.log(`  users     : ${counts.users}`);
  console.log(`  branches  : ${counts.branches}`);
  console.log(`  sessions  : ${counts.sessions}`);
  console.log(`  demo payment history: ${demoPayments} rows (read only when DEMO_HISTORY_ENABLED=true)`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

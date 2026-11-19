import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

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

/** Noon, so a date can never slide into the previous day by timezone. */
function monthsAgo(months: number, dayOfMonth: number): Date {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - months, 1, 12, 0, 0, 0);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(dayOfMonth, lastDay));
  return date;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date;
}

/**
 * Demonstration payment history for the local account.
 *
 * This is NOT customer data and NOT a bank record. It exists so the
 * remembered-payment suggestions have something to find on a developer
 * machine, and it is only ever read when DEMO_HISTORY_ENABLED is on.
 *
 * It is shaped to exercise all three cases the detectors must handle:
 *
 *   Rahul  a genuine monthly pattern on today's day-of-month, with the
 *          CURRENT month deliberately missing -- that is the whole
 *          premise of the recurring card: the payment is due and has
 *          not been made yet
 *   Priya  a single recent payment, so the last-payment card has a
 *          different payee and the two cards cannot collapse into one
 *   Vinay  three payments inside one week, months ago, which must NOT
 *          be mistaken for a monthly habit
 */
async function seedDemoPaymentHistory(userId: string): Promise<number> {
  // Re-runnable: the demonstration rows are rebuilt from scratch rather
  // than accumulating a new copy on every seed. Only DEMO_SEEDED payees
  // are touched, so anything a customer entered is left alone.
  await prisma.demoPaymentHistory.deleteMany({ where: { userId } });
  await prisma.payee.deleteMany({ where: { userId, trust: 'DEMO_SEEDED' } });

  const today = new Date().getDate();

  const rahul = await prisma.payee.create({
    data: {
      userId,
      displayName: 'Rahul',
      fullName: 'Rahul Shetty',
      accountLast4: '4821',
      trust: 'DEMO_SEEDED',
    },
  });

  const priya = await prisma.payee.create({
    data: {
      userId,
      displayName: 'Priya',
      fullName: 'Priya Nayak',
      accountLast4: '7310',
      trust: 'DEMO_SEEDED',
    },
  });

  const vinay = await prisma.payee.create({
    data: {
      userId,
      displayName: 'Vinay',
      fullName: 'Vinay Rao',
      accountLast4: '9052',
      trust: 'DEMO_SEEDED',
    },
  });

  // A real habit is never exactly on the same date every month, so the
  // dates jitter by a day. The detector tolerates that; a detector that
  // only matched an exact date would never fire in practice.
  const jitter = [0, 1, -1, 0, 1, -1];

  const payments = [
    // The monthly pattern: five months back to one month back.
    ...[1, 2, 3, 4, 5].map((months) => ({
      userId,
      payeeId: rahul.id,
      amountMinor: 500_000,
      occurredAt: monthsAgo(months, today + jitter[months]),
    })),

    // The most recent payment, to someone else.
    { userId, payeeId: priya.id, amountMinor: 125_000, occurredAt: daysAgo(5) },

    // Three payments in one week, three months ago: frequent, but not
    // monthly, and not around today.
    { userId, payeeId: vinay.id, amountMinor: 30_000, occurredAt: monthsAgo(3, 8) },
    { userId, payeeId: vinay.id, amountMinor: 45_000, occurredAt: monthsAgo(3, 10) },
    { userId, payeeId: vinay.id, amountMinor: 20_000, occurredAt: monthsAgo(3, 12) },
  ];

  await prisma.demoPaymentHistory.createMany({ data: payments });

  return payments.length;
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

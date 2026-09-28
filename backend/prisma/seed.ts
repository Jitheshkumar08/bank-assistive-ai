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
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

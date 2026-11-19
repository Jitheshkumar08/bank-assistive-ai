import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRONG_PASSWORD, createTestApp, uniqueEmail } from './helpers';

/**
 * The personalisation testing dashboard, end to end.
 *
 * The properties that matter here are negative ones. The preview must
 * create no suggestion offer -- that is the whole premise of previewing
 * rather than listing. A customer must not reach any of it. A simulated
 * date must change what the rules conclude without touching a single
 * row. And nothing anywhere may carry more of an account number than
 * its last four digits.
 *
 * DEMO_DASHBOARD_ENABLED and DEMO_HISTORY_ENABLED are both true in this
 * environment; the production refusal is unit-tested, since NODE_ENV
 * cannot be changed inside a booted application.
 */
describe('Personalisation testing dashboard', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerToken: string;
  let subjectId: string;

  const created: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => 'Bearer ' + token;

  /** Local noon, as the seed and the detectors both use. */
  function monthsAgo(months: number, day: number): Date {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth() - months, 1, 12, 0, 0, 0);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
    return date;
  }

  function daysAgo(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    const adminLogin = await http().post('/api/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken;

    // An ordinary customer, to prove the role check bites.
    const outsiderEmail = uniqueEmail('demo-dash-outsider');
    created.push(outsiderEmail);

    const outsider = await http()
      .post('/api/auth/register')
      .send({ email: outsiderEmail, fullName: 'Outsider', password: STRONG_PASSWORD });

    customerToken = outsider.body.accessToken;

    // The customer under test, with a monthly habit on the 16th and one
    // recent payment to someone else.
    const subjectEmail = uniqueEmail('demo-dash-subject');
    created.push(subjectEmail);

    const subject = await http()
      .post('/api/auth/register')
      .send({ email: subjectEmail, fullName: 'Dashboard Subject', password: STRONG_PASSWORD });

    subjectId = subject.body.user.id;

    const rahul = await prisma.payee.create({
      data: {
        userId: subjectId,
        displayName: 'Rahul',
        fullName: 'Rahul Shetty',
        accountLast4: '4821',
        trust: 'DEMO_SEEDED',
      },
    });

    const priya = await prisma.payee.create({
      data: {
        userId: subjectId,
        displayName: 'Priya',
        accountLast4: '7310',
        trust: 'DEMO_SEEDED',
      },
    });

    await prisma.demoPaymentHistory.createMany({
      data: [
        ...[1, 2, 3, 4].map((months) => ({
          userId: subjectId,
          payeeId: rahul.id,
          amountMinor: 500_000,
          occurredAt: monthsAgo(months, 16),
        })),
        { userId: subjectId, payeeId: priya.id, amountMinor: 125_000, occurredAt: daysAgo(5) },
        // Deliberately not completed: it must never reach a detector.
        {
          userId: subjectId,
          payeeId: rahul.id,
          amountMinor: 500_000,
          occurredAt: daysAgo(2),
          status: 'FAILED' as const,
        },
      ],
    });
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: created } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);

    await prisma.suggestionOffer.deleteMany({ where: { userId: { in: ids } } });
    await prisma.assistedActivity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.demoPaymentHistory.deleteMany({ where: { userId: { in: ids } } });
    await prisma.payee.deleteMany({ where: { userId: { in: ids } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });

    await app.close();
  });

  /** The 16th of this month at noon, so the habit lands on it. */
  function onTheSixteenth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 16, 12, 0, 0, 0).toISOString();
  }

  const asAdmin = (path: string) => http().get(path).set('Authorization', bearer(adminToken));

  describe('who may reach it', () => {
    it('refuses anonymous callers', async () => {
      await expect(http().get('/api/admin/demo/customers').then((r) => r.status)).resolves.toBe(
        401,
      );
    });

    it('refuses an ordinary customer', async () => {
      const response = await http()
        .get('/api/admin/demo/customers')
        .set('Authorization', bearer(customerToken));

      expect(response.status).toBe(403);
    });

    it('refuses a customer the preview route as well', async () => {
      const response = await http()
        .get(`/api/admin/demo/customers/${subjectId}/preview`)
        .set('Authorization', bearer(customerToken));

      expect(response.status).toBe(403);
    });

    it('lets an admin in, and never caches what it says', async () => {
      const response = await asAdmin('/api/admin/demo/customers');

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
    });
  });

  describe('the customer selector', () => {
    it('lists customers with how much demonstration history each has', async () => {
      const response = await asAdmin('/api/admin/demo/customers');

      const subject = response.body.find(
        (row: { userId: string }) => row.userId === subjectId,
      );

      expect(subject).toMatchObject({
        userId: subjectId,
        fullName: 'Dashboard Subject',
        suggestionsEnabled: true,
        demoPaymentCount: 6,
        demoPayeeCount: 2,
      });
      expect(subject.lastDemoPaymentAt).not.toBeNull();
    });

    it('never offers an admin account as a test subject', async () => {
      const response = await asAdmin('/api/admin/demo/customers');
      const emails = response.body.map((row: { email: string }) => row.email);

      expect(emails).not.toContain(process.env.ADMIN_EMAIL);
    });

    it('refuses to point at an account that is not a customer', async () => {
      const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

      const response = await asAdmin(`/api/admin/demo/customers/${admin!.id}/preview`);

      expect(response.status).toBe(404);
    });
  });

  describe('the payment history overview', () => {
    it('annotates which rows the detectors actually read', async () => {
      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/payments?at=${onTheSixteenth()}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.payments).toHaveLength(6);

      const failed = response.body.payments.find(
        (row: { status: string }) => row.status === 'FAILED',
      );

      expect(failed).toMatchObject({
        countsTowardSuggestions: false,
        ignoredReason: 'NOT_COMPLETED',
      });

      const counted = response.body.payments.filter(
        (row: { countsTowardSuggestions: boolean }) => row.countsTowardSuggestions,
      );

      expect(counted).toHaveLength(5);
    });

    it('marks a future-dated row as ignored rather than hiding it', async () => {
      // Evaluated a year ago: every row is then in the future.
      const longAgo = new Date();
      longAgo.setFullYear(longAgo.getFullYear() - 1);

      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/payments?at=${longAgo.toISOString()}`,
      );

      const reasons = response.body.payments.map(
        (row: { ignoredReason: string | null }) => row.ignoredReason,
      );

      expect(reasons).toContain('FUTURE_DATED');
      expect(response.body.payments).toHaveLength(6);
      expect(response.body.isSimulated).toBe(true);
    });

    it('shows no more of an account than its last four digits', async () => {
      const response = await asAdmin(`/api/admin/demo/customers/${subjectId}/payments`);

      for (const row of response.body.payments) {
        expect(Object.keys(row.payee).sort()).toEqual([
          'accountLast4',
          'displayName',
          'fullName',
          'id',
          'trust',
        ]);
        expect(row.payee.accountLast4).toMatch(/^\d{4}$/);
      }
    });
  });

  describe('the live preview', () => {
    it('reaches the same verdict the welcome screen would', async () => {
      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.recurring.verdict).toBe('MATCHED');
      expect(response.body.recurring.candidate).toMatchObject({
        type: 'RECURRING_TODAY',
        displayName: 'Rahul',
        amountMinor: 500_000,
        occurrenceCount: 4,
        usualDayOfMonth: 16,
        isBankVerified: false,
        provenance: 'DEMO_HISTORY',
      });

      expect(response.body.last.candidate).toMatchObject({
        type: 'LAST_PAYMENT',
        displayName: 'Priya',
      });

      expect(
        response.body.wouldOffer.map((item: { type: string }) => item.type),
      ).toEqual(['RECURRING_TODAY', 'LAST_PAYMENT']);
      expect(response.body.gating.wouldAppearOnWelcome).toBe(true);
    });

    it('CREATES NO SUGGESTION OFFER, however many times it is asked', async () => {
      // The single most important assertion in this file.
      const before = await prisma.suggestionOffer.count();

      await asAdmin(`/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`);
      await asAdmin(`/api/admin/demo/customers/${subjectId}/preview`);
      await asAdmin(`/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`);

      expect(await prisma.suggestionOffer.count()).toBe(before);
      expect(await prisma.suggestionOffer.count({ where: { userId: subjectId } })).toBe(0);
    });

    it('starts no session and no activity for the customer', async () => {
      await asAdmin(`/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`);

      expect(await prisma.session.count({ where: { userId: subjectId } })).toBe(0);
      expect(await prisma.assistedActivity.count({ where: { userId: subjectId } })).toBe(0);
    });

    it('changes nothing in the history it reads', async () => {
      const before = await prisma.demoPaymentHistory.findMany({
        where: { userId: subjectId },
        orderBy: { id: 'asc' },
      });

      await asAdmin(`/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`);

      const after = await prisma.demoPaymentHistory.findMany({
        where: { userId: subjectId },
        orderBy: { id: 'asc' },
      });

      expect(after).toEqual(before);
    });

    it('counts what the detectors never saw, and says why', async () => {
      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`,
      );

      expect(response.body).toMatchObject({
        historyTotal: 6,
        historyUsed: 5,
        excludedByStatus: 1,
        excludedAsFuture: 0,
        excludedByWindow: 0,
      });
    });

    it('explains a silence instead of merely reporting one', async () => {
      // The 1st: the habit is on the 16th, so it is well outside the
      // tolerance and the card must stay quiet.
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);

      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/preview?at=${first.toISOString()}`,
      );

      expect(response.body.recurring.verdict).toBe('NO_PATTERN_MATCHED_TODAY');
      expect(response.body.recurring.candidate).toBeNull();

      const rahul = response.body.recurring.findings.find(
        (finding: { displayName: string }) => finding.displayName === 'Rahul',
      );

      expect(rahul).toMatchObject({
        verdict: 'TODAY_OUTSIDE_WINDOW',
        modal: 16,
        todayValue: 1,
        distinctMonths: 4,
      });
      expect(response.body.recurring.thresholds).toMatchObject({
        minOccurrences: 3,
        clusterToleranceDays: 3,
        todayToleranceDays: 2,
        lookbackDays: 180,
      });
    });

    it('reports the gates it does not itself apply', async () => {
      await prisma.user.update({
        where: { id: subjectId },
        data: { suggestionsEnabled: false },
      });

      try {
        const response = await asAdmin(
          `/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`,
        );

        // The rules still produce a card...
        expect(response.body.wouldOffer).toHaveLength(2);
        // ...but the customer has opted out, so the welcome screen
        // would show nothing. An admin must be told that.
        expect(response.body.gating.accountOptedIn).toBe(false);
        expect(response.body.gating.wouldAppearOnWelcome).toBe(false);
      } finally {
        await prisma.user.update({
          where: { id: subjectId },
          data: { suggestionsEnabled: true },
        });
      }
    });

    it('never returns a full account number', async () => {
      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/preview?at=${onTheSixteenth()}`,
      );

      const body = JSON.stringify(response.body);

      expect(body).not.toContain('accountNumber');
      // Amounts are the only long digit runs; no payee object may hold one.
      for (const item of response.body.wouldOffer) {
        expect(item.accountLast4).toMatch(/^\d{4}$/);
      }
    });
  });

  describe('adding, changing and removing records', () => {
    const asAdminPost = (path: string, body: object) =>
      http().post(path).set('Authorization', bearer(adminToken)).send(body);

    const asAdminPatch = (path: string, body: object) =>
      http().patch(path).set('Authorization', bearer(adminToken)).send(body);

    const asAdminDelete = (path: string) =>
      http().delete(path).set('Authorization', bearer(adminToken));

    const writes = () => `/api/admin/demo/customers/${subjectId}/payments`;

    /** A throwaway customer, so a write test cannot disturb the shared subject. */
    async function scratchCustomer(): Promise<{ userId: string; payeeId: string }> {
      const email = uniqueEmail('demo-dash-write');
      created.push(email);

      const registered = await http()
        .post('/api/auth/register')
        .send({ email, fullName: 'Write Subject', password: STRONG_PASSWORD });

      const userId = registered.body.user.id;

      const payee = await prisma.payee.create({
        data: { userId, displayName: 'Meera', accountLast4: '1234', trust: 'DEMO_SEEDED' },
      });

      return { userId, payeeId: payee.id };
    }

    function validBody(payeeId: string) {
      return {
        payeeId,
        amountMinor: 250_000,
        occurredAt: daysAgo(10).toISOString(),
        status: 'COMPLETED' as const,
      };
    }

    describe('who may write', () => {
      it('refuses anonymous callers on every verb', async () => {
        const row = await prisma.demoPaymentHistory.findFirst({ where: { userId: subjectId } });

        expect((await http().post(writes()).send({})).status).toBe(401);
        expect((await http().patch(`${writes()}/${row!.id}`).send({})).status).toBe(401);
        expect((await http().delete(`${writes()}/${row!.id}`)).status).toBe(401);
      });

      it('refuses an ordinary customer on every verb', async () => {
        const row = await prisma.demoPaymentHistory.findFirst({ where: { userId: subjectId } });
        const as = (r: request.Test) => r.set('Authorization', bearer(customerToken));

        expect((await as(http().post(writes())).send({})).status).toBe(403);
        expect((await as(http().patch(`${writes()}/${row!.id}`)).send({})).status).toBe(403);
        expect((await as(http().delete(`${writes()}/${row!.id}`))).status).toBe(403);
      });

      it('refuses to write against an account that is not a customer', async () => {
        const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

        const response = await asAdminPost(
          `/api/admin/demo/customers/${admin!.id}/payments`,
          validBody(await scratchCustomer().then((s) => s.payeeId)),
        );

        expect(response.status).toBe(404);
      });
    });

    describe('creating', () => {
      it('adds a record against an existing demonstration payee', async () => {
        const { userId, payeeId } = await scratchCustomer();

        const response = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(payeeId),
        );

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
          amountMinor: 250_000,
          currency: 'INR',
          status: 'COMPLETED',
          payee: { displayName: 'Meera', accountLast4: '1234', trust: 'DEMO_SEEDED' },
        });

        expect(await prisma.demoPaymentHistory.count({ where: { userId } })).toBe(1);
      });

      it('creates a new payee as DEMO_SEEDED and nothing else', async () => {
        const { userId } = await scratchCustomer();

        const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          newPayee: { displayName: 'Lakshmi', fullName: 'Lakshmi Rao', accountLast4: '5678' },
          amountMinor: 100_000,
          occurredAt: daysAgo(3).toISOString(),
          status: 'COMPLETED',
        });

        expect(response.status).toBe(201);
        expect(response.body.payee.trust).toBe('DEMO_SEEDED');

        const payee = await prisma.payee.findFirst({
          where: { userId, displayName: 'Lakshmi' },
        });

        // There is no request field that could ask for anything else,
        // and the stored row proves it.
        expect(payee!.trust).toBe('DEMO_SEEDED');
      });

      it('insists on exactly one of payeeId and newPayee', async () => {
        const { userId, payeeId } = await scratchCustomer();

        const neither = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          amountMinor: 100_000,
          occurredAt: daysAgo(3).toISOString(),
          status: 'COMPLETED',
        });

        const both = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          payeeId,
          newPayee: { displayName: 'Lakshmi', accountLast4: '5678' },
          amountMinor: 100_000,
          occurredAt: daysAgo(3).toISOString(),
          status: 'COMPLETED',
        });

        expect(neither.status).toBe(422);
        expect(both.status).toBe(422);
      });

      it('REFUSES a payee belonging to another customer', async () => {
        const mine = await scratchCustomer();
        const theirs = await scratchCustomer();

        const response = await asAdminPost(
          `/api/admin/demo/customers/${mine.userId}/payments`,
          validBody(theirs.payeeId),
        );

        expect(response.status).toBe(422);
        expect(await prisma.demoPaymentHistory.count({ where: { userId: mine.userId } })).toBe(0);
      });

      it('REFUSES a payee the customer entered themselves', async () => {
        // The isolation rule: demonstration history must never be hung
        // off a genuine beneficiary.
        const { userId } = await scratchCustomer();

        const real = await prisma.payee.create({
          data: {
            userId,
            displayName: 'Real Landlord',
            accountLast4: '9999',
            trust: 'CUSTOMER_PROVIDED',
          },
        });

        const response = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(real.id),
        );

        expect(response.status).toBe(422);
      });

      it('REFUSES a bank-verified payee', async () => {
        const { userId } = await scratchCustomer();

        const verified = await prisma.payee.create({
          data: {
            userId,
            displayName: 'Verified Payee',
            accountLast4: '8888',
            trust: 'BANK_VERIFIED',
          },
        });

        const response = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(verified.id),
        );

        expect(response.status).toBe(422);
      });

      it('enforces the amount ceiling the review screen also enforces', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const ceiling = Number(process.env.ACTIVITY_MAX_AMOUNT_MINOR ?? 1_000_000);

        // A WHOLE rupee above the ceiling, so this isolates the ceiling
        // rule rather than tripping the whole-rupee one first.
        const tooMuch = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          amountMinor: ceiling + 100,
        });

        const atCeiling = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          amountMinor: ceiling,
        });

        expect(tooMuch.status).toBe(422);
        expect(atCeiling.status).toBe(201);
      });

      it('refuses less than a rupee', async () => {
        const { userId, payeeId } = await scratchCustomer();

        const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          amountMinor: 99,
        });

        expect(response.status).toBe(400);
      });

      it('REFUSES a fractional rupee, however it is phrased', async () => {
        // The form only offers whole rupees, but the API is the actual
        // boundary -- and formatAmount shows no decimal places, so 4999
        // paise would be DISPLAYED as "₹50" everywhere while the stored
        // value stayed 4999.
        const { userId, payeeId } = await scratchCustomer();

        for (const amountMinor of [4999, 101, 250_050, 999]) {
          const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
            ...validBody(payeeId),
            amountMinor,
          });

          expect(response.status).toBe(400);
        }

        // Nothing fractional reached the database.
        expect(await prisma.demoPaymentHistory.count({ where: { userId } })).toBe(0);
      });

      it('accepts whole rupees at both ends of the range', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const ceiling = Number(process.env.ACTIVITY_MAX_AMOUNT_MINOR ?? 1_000_000);

        for (const amountMinor of [100, 5_000, ceiling]) {
          const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
            ...validBody(payeeId),
            amountMinor,
          });

          expect(response.status).toBe(201);
          expect(response.body.amountMinor % 100).toBe(0);
        }
      });

      it('accepts all three statuses', async () => {
        const { userId, payeeId } = await scratchCustomer();

        for (const status of ['COMPLETED', 'FAILED', 'PENDING'] as const) {
          const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
            ...validBody(payeeId),
            status,
          });

          expect(response.status).toBe(201);
          expect(response.body.status).toBe(status);
        }
      });

      it('refuses a status it does not recognise', async () => {
        const { userId, payeeId } = await scratchCustomer();

        const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          status: 'SETTLED',
        });

        expect(response.status).toBe(400);
      });

      it('refuses a payee name with digits in it', async () => {
        // Such a name would end up in the SPOKEN line, where no digit
        // may ever appear.
        const { userId } = await scratchCustomer();

        const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          newPayee: { displayName: 'Rahul 2', accountLast4: '5678' },
          amountMinor: 100_000,
          occurredAt: daysAgo(3).toISOString(),
          status: 'COMPLETED',
        });

        expect(response.status).toBe(400);
      });

      it('insists on exactly four digits of account', async () => {
        const { userId } = await scratchCustomer();

        for (const accountLast4 of ['123', '12345', 'abcd', '']) {
          const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
            newPayee: { displayName: 'Lakshmi', accountLast4 },
            amountMinor: 100_000,
            occurredAt: daysAgo(3).toISOString(),
            status: 'COMPLETED',
          });

          expect(response.status).toBe(400);
        }
      });

      it('rejects a currency field rather than pretending to honour it', async () => {
        const { userId, payeeId } = await scratchCustomer();

        const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          currency: 'USD',
        });

        expect(response.status).toBe(400);
      });

      it('refuses a date it cannot read, or one absurdly far away', async () => {
        const { userId, payeeId } = await scratchCustomer();

        const unreadable = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          occurredAt: 'last Tuesday',
        });

        const tooFar = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          occurredAt: '2099-01-01T00:00:00.000Z',
        });

        expect(unreadable.status).toBe(400);
        expect(tooFar.status).toBe(422);
      });

      it('allows a future date, which the detectors then ignore', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const soon = new Date();
        soon.setDate(soon.getDate() + 7);

        const created = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
          ...validBody(payeeId),
          occurredAt: soon.toISOString(),
        });

        expect(created.status).toBe(201);

        const listed = await asAdmin(`/api/admin/demo/customers/${userId}/payments`);

        expect(listed.body.payments[0]).toMatchObject({
          countsTowardSuggestions: false,
          ignoredReason: 'FUTURE_DATED',
        });
      });
    });

    describe('changing', () => {
      it('changes only what it is asked to', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const created = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(payeeId),
        );

        const response = await asAdminPatch(
          `/api/admin/demo/customers/${userId}/payments/${created.body.id}`,
          { status: 'FAILED' },
        );

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          status: 'FAILED',
          // Untouched.
          amountMinor: 250_000,
          occurredAt: created.body.occurredAt,
        });
      });

      it('refuses an empty body', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const created = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(payeeId),
        );

        const response = await asAdminPatch(
          `/api/admin/demo/customers/${userId}/payments/${created.body.id}`,
          {},
        );

        expect(response.status).toBe(422);
      });

      it('REFUSES to move a record onto another customer\'s payee', async () => {
        const mine = await scratchCustomer();
        const theirs = await scratchCustomer();
        const created = await asAdminPost(
          `/api/admin/demo/customers/${mine.userId}/payments`,
          validBody(mine.payeeId),
        );

        const response = await asAdminPatch(
          `/api/admin/demo/customers/${mine.userId}/payments/${created.body.id}`,
          { payeeId: theirs.payeeId },
        );

        expect(response.status).toBe(422);

        const unchanged = await prisma.demoPaymentHistory.findUnique({
          where: { id: created.body.id },
        });

        expect(unchanged!.payeeId).toBe(mine.payeeId);
      });

      it('CANNOT reach a record through the wrong customer\'s URL', async () => {
        const mine = await scratchCustomer();
        const theirs = await scratchCustomer();
        const created = await asAdminPost(
          `/api/admin/demo/customers/${mine.userId}/payments`,
          validBody(mine.payeeId),
        );

        // Right row id, wrong customer in the path.
        const response = await asAdminPatch(
          `/api/admin/demo/customers/${theirs.userId}/payments/${created.body.id}`,
          { status: 'FAILED' },
        );

        expect(response.status).toBe(404);

        const unchanged = await prisma.demoPaymentHistory.findUnique({
          where: { id: created.body.id },
        });

        expect(unchanged!.status).toBe('COMPLETED');
      });

      it('enforces the ceiling on an edited amount too', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const ceiling = Number(process.env.ACTIVITY_MAX_AMOUNT_MINOR ?? 1_000_000);
        const created = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(payeeId),
        );

        const response = await asAdminPatch(
          `/api/admin/demo/customers/${userId}/payments/${created.body.id}`,
          // A whole rupee above the ceiling, for the same reason.
          { amountMinor: ceiling + 100 },
        );

        expect(response.status).toBe(422);
      });

      it('refuses a fractional rupee on an edit too, and changes nothing', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const created = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(payeeId),
        );

        const response = await asAdminPatch(
          `/api/admin/demo/customers/${userId}/payments/${created.body.id}`,
          { amountMinor: 4999 },
        );

        expect(response.status).toBe(400);

        const unchanged = await prisma.demoPaymentHistory.findUnique({
          where: { id: created.body.id },
        });

        expect(unchanged!.amountMinor).toBe(250_000);
      });
    });

    describe('removing', () => {
      it('deletes one record and leaves the payee alone', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const created = await asAdminPost(
          `/api/admin/demo/customers/${userId}/payments`,
          validBody(payeeId),
        );

        const response = await asAdminDelete(
          `/api/admin/demo/customers/${userId}/payments/${created.body.id}`,
        );

        expect(response.status).toBe(204);
        expect(
          await prisma.demoPaymentHistory.findUnique({ where: { id: created.body.id } }),
        ).toBeNull();
        // The beneficiary survives: it may be wanted again in a moment.
        expect(await prisma.payee.findUnique({ where: { id: payeeId } })).not.toBeNull();
      });

      it('CANNOT delete through the wrong customer\'s URL', async () => {
        const mine = await scratchCustomer();
        const theirs = await scratchCustomer();
        const created = await asAdminPost(
          `/api/admin/demo/customers/${mine.userId}/payments`,
          validBody(mine.payeeId),
        );

        const response = await asAdminDelete(
          `/api/admin/demo/customers/${theirs.userId}/payments/${created.body.id}`,
        );

        expect(response.status).toBe(404);
        expect(
          await prisma.demoPaymentHistory.findUnique({ where: { id: created.body.id } }),
        ).not.toBeNull();
      });
    });

    describe('what a written record does to the detectors', () => {
      /** A habit on the 16th across four months, built through the API. */
      async function giveHabit(userId: string, payeeId: string, status: 'COMPLETED' | 'FAILED') {
        for (const months of [1, 2, 3, 4]) {
          const response = await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
            payeeId,
            amountMinor: 500_000,
            occurredAt: monthsAgo(months, 16).toISOString(),
            status,
          });

          expect(response.status).toBe(201);
        }
      }

      it('a COMPLETED habit written here produces a card', async () => {
        const { userId, payeeId } = await scratchCustomer();
        await giveHabit(userId, payeeId, 'COMPLETED');

        const response = await asAdmin(
          `/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`,
        );

        expect(response.body.recurring.verdict).toBe('MATCHED');
        expect(response.body.recurring.candidate.displayName).toBe('Meera');
      });

      it('THE SAME HABIT, written as FAILED, produces nothing at all', async () => {
        const { userId, payeeId } = await scratchCustomer();
        await giveHabit(userId, payeeId, 'FAILED');

        const response = await asAdmin(
          `/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`,
        );

        expect(response.body.recurring.verdict).toBe('NO_HISTORY_IN_WINDOW');
        expect(response.body.recurring.candidate).toBeNull();
        expect(response.body.last.candidate).toBeNull();
        expect(response.body.historyUsed).toBe(0);
        expect(response.body.excludedByStatus).toBe(4);
      });

      it('and written as PENDING, likewise nothing', async () => {
        const { userId, payeeId } = await scratchCustomer();

        for (const months of [1, 2, 3, 4]) {
          await asAdminPost(`/api/admin/demo/customers/${userId}/payments`, {
            payeeId,
            amountMinor: 500_000,
            occurredAt: monthsAgo(months, 16).toISOString(),
            status: 'PENDING',
          });
        }

        const response = await asAdmin(
          `/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`,
        );

        expect(response.body.recurring.candidate).toBeNull();
        expect(response.body.last.candidate).toBeNull();
        expect(response.body.historyUsed).toBe(0);
      });

      it('editing COMPLETED to FAILED takes the card away again', async () => {
        const { userId, payeeId } = await scratchCustomer();
        await giveHabit(userId, payeeId, 'COMPLETED');

        const before = await asAdmin(
          `/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`,
        );

        expect(before.body.recurring.verdict).toBe('MATCHED');

        const rows = await prisma.demoPaymentHistory.findMany({ where: { userId } });

        for (const row of rows) {
          const response = await asAdminPatch(
            `/api/admin/demo/customers/${userId}/payments/${row.id}`,
            { status: 'FAILED' },
          );

          expect(response.status).toBe(200);
        }

        const after = await asAdmin(
          `/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`,
        );

        expect(after.body.recurring.candidate).toBeNull();
      });

      it('writing a record creates no suggestion offer and no activity', async () => {
        const { userId, payeeId } = await scratchCustomer();
        const offersBefore = await prisma.suggestionOffer.count();

        await giveHabit(userId, payeeId, 'COMPLETED');
        await asAdmin(`/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`);

        expect(await prisma.suggestionOffer.count()).toBe(offersBefore);
        expect(await prisma.assistedActivity.count({ where: { userId } })).toBe(0);
        expect(await prisma.session.count({ where: { userId } })).toBe(0);
      });
    });
  });

  /**
   * Clearing and restoring.
   *
   * These are the two actions that act on a customer's whole history at
   * once, so what they must NOT reach matters more than what they do.
   * A beneficiary the customer entered themselves, an assisted activity
   * that recorded a real branch visit, and a suggestion offer are all
   * out of bounds -- and the restore has to put back exactly what a
   * freshly seeded machine starts with, or "restore" means nothing.
   */
  describe('clearing and restoring', () => {
    const asAdminPost = (path: string, body?: object) =>
      http().post(path).set('Authorization', bearer(adminToken)).send(body ?? {});

    const asAdminDelete = (path: string) =>
      http().delete(path).set('Authorization', bearer(adminToken));

    const clearPath = (userId: string) => `/api/admin/demo/customers/${userId}/payments`;
    const restorePath = (userId: string) => `/api/admin/demo/customers/${userId}/restore`;

    /** A throwaway customer, so nothing here can disturb the shared subject. */
    async function scratch(): Promise<{ userId: string; payeeId: string }> {
      const email = uniqueEmail('demo-dash-bulk');
      created.push(email);

      const registered = await http()
        .post('/api/auth/register')
        .send({ email, fullName: 'Bulk Subject', password: STRONG_PASSWORD });

      const userId = registered.body.user.id;

      const payee = await prisma.payee.create({
        data: { userId, displayName: 'Meera', accountLast4: '1234', trust: 'DEMO_SEEDED' },
      });

      return { userId, payeeId: payee.id };
    }

    async function givePayments(userId: string, payeeId: string, count: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        const response = await asAdminPost(clearPath(userId), {
          payeeId,
          amountMinor: 250_000,
          occurredAt: daysAgo(10 + index).toISOString(),
          status: 'COMPLETED',
        });

        expect(response.status).toBe(201);
      }
    }

    describe('who may do it', () => {
      it('refuses anonymous callers on both routes', async () => {
        expect((await http().delete(clearPath(subjectId))).status).toBe(401);
        expect((await http().post(restorePath(subjectId)).send({})).status).toBe(401);
      });

      it('refuses an ordinary customer on both routes', async () => {
        const as = (r: request.Test) => r.set('Authorization', bearer(customerToken));

        expect((await as(http().delete(clearPath(subjectId)))).status).toBe(403);
        expect((await as(http().post(restorePath(subjectId))).send({})).status).toBe(403);
      });

      it('leaves the history untouched when it refuses', async () => {
        const before = await prisma.demoPaymentHistory.count({ where: { userId: subjectId } });

        await http().delete(clearPath(subjectId));
        await http()
          .delete(clearPath(subjectId))
          .set('Authorization', bearer(customerToken));

        expect(await prisma.demoPaymentHistory.count({ where: { userId: subjectId } })).toBe(
          before,
        );
      });

      it('refuses to act on an account that is not a customer', async () => {
        const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

        expect((await asAdminDelete(clearPath(admin!.id))).status).toBe(404);
        expect((await asAdminPost(restorePath(admin!.id))).status).toBe(404);
      });
    });

    describe('clearing', () => {
      it('removes every record and the beneficiaries seeded with them', async () => {
        const { userId, payeeId } = await scratch();
        await givePayments(userId, payeeId, 3);

        const response = await asAdminDelete(clearPath(userId));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          paymentsDeleted: 3,
          payeesDeleted: 1,
          payeesRetained: 0,
        });

        expect(await prisma.demoPaymentHistory.count({ where: { userId } })).toBe(0);
        expect(await prisma.payee.count({ where: { userId } })).toBe(0);
        // The summary it answers with is the emptied one, not the stale count.
        expect(response.body.customer.demoPaymentCount).toBe(0);
        expect(response.body.customer.demoPayeeCount).toBe(0);
      });

      it('is content to clear a history that is already empty', async () => {
        const { userId } = await scratch();

        // The payee from scratch() has no payments, and goes too.
        const response = await asAdminDelete(clearPath(userId));

        expect(response.status).toBe(200);
        expect(response.body.paymentsDeleted).toBe(0);
        expect(response.body.payeesDeleted).toBe(1);
      });

      it('LEAVES A BENEFICIARY THE CUSTOMER ENTERED THEMSELVES ALONE', async () => {
        const { userId, payeeId } = await scratch();
        await givePayments(userId, payeeId, 1);

        const real = await prisma.payee.create({
          data: {
            userId,
            displayName: 'Anitha',
            accountLast4: '9999',
            trust: 'CUSTOMER_PROVIDED',
          },
        });

        const response = await asAdminDelete(clearPath(userId));

        expect(response.status).toBe(200);
        // It is not even counted: the query cannot see it.
        expect(response.body.payeesDeleted).toBe(1);
        expect(await prisma.payee.findUnique({ where: { id: real.id } })).not.toBeNull();
      });

      it('KEEPS a seeded beneficiary an assisted activity still refers to', async () => {
        const { userId, payeeId } = await scratch();
        await givePayments(userId, payeeId, 2);

        // A record of something that happened in a branch. Its payee
        // relation is onDelete: SetNull, so deleting the beneficiary
        // would silently blank the column rather than fail.
        const activity = await prisma.assistedActivity.create({
          data: {
            userId,
            payeeId,
            kind: 'PAYMENT_GUIDANCE',
            amountMinor: 250_000,
            occurredAt: daysAgo(1),
          },
        });

        const response = await asAdminDelete(clearPath(userId));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          paymentsDeleted: 2,
          payeesDeleted: 0,
          payeesRetained: 1,
        });

        // The demonstration rows are gone; the record of the visit is
        // intact, and still knows who it was about.
        expect(await prisma.demoPaymentHistory.count({ where: { userId } })).toBe(0);
        expect(await prisma.payee.findUnique({ where: { id: payeeId } })).not.toBeNull();

        const after = await prisma.assistedActivity.findUnique({ where: { id: activity.id } });

        expect(after!.payeeId).toBe(payeeId);
      });

      it('silences every suggestion, because there is nothing left to read', async () => {
        const { userId, payeeId } = await scratch();

        // A habit on the 16th, which the preview would otherwise offer.
        for (const months of [1, 2, 3, 4]) {
          await asAdminPost(clearPath(userId), {
            payeeId,
            amountMinor: 500_000,
            occurredAt: monthsAgo(months, 16).toISOString(),
            status: 'COMPLETED',
          });
        }

        const before = await asAdmin(
          `/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`,
        );

        expect(before.body.wouldOffer.length).toBeGreaterThan(0);

        await asAdminDelete(clearPath(userId));

        const after = await asAdmin(
          `/api/admin/demo/customers/${userId}/preview?at=${onTheSixteenth()}`,
        );

        expect(after.body.historyTotal).toBe(0);
        expect(after.body.historyUsed).toBe(0);
        expect(after.body.wouldOffer).toEqual([]);
        expect(after.body.gating.wouldAppearOnWelcome).toBe(false);
      });
    });

    describe('restoring', () => {
      it('writes the seeded fixture: nine records across three beneficiaries', async () => {
        const { userId } = await scratch();

        const response = await asAdminPost(restorePath(userId));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          paymentsCreated: 9,
          payeesCreated: 3,
          payeesReused: 0,
        });

        expect(await prisma.demoPaymentHistory.count({ where: { userId } })).toBe(9);
        expect(
          await prisma.payee.count({ where: { userId, trust: 'DEMO_SEEDED' } }),
        ).toBe(3);

        // The summary answers with the restored state, not the old one.
        expect(response.body.customer.demoPaymentCount).toBe(9);
        expect(response.body.customer.demoPayeeCount).toBe(3);
      });

      it('writes nothing but completed, whole-rupee INR records', async () => {
        const { userId } = await scratch();

        await asAdminPost(restorePath(userId));

        const rows = await prisma.demoPaymentHistory.findMany({ where: { userId } });

        for (const row of rows) {
          expect(row.status).toBe('COMPLETED');
          expect(row.currency).toBe('INR');
          // Paise are displayed nowhere, so a fractional rupee would
          // make every screen disagree with the row.
          expect(row.amountMinor % 100).toBe(0);
        }
      });

      it('clears what was there first, and says what it replaced', async () => {
        const { userId, payeeId } = await scratch();
        await givePayments(userId, payeeId, 2);

        const response = await asAdminPost(restorePath(userId));

        expect(response.status).toBe(200);
        expect(response.body.cleared.paymentsDeleted).toBe(2);
        expect(response.body.paymentsCreated).toBe(9);
        // Nine, not eleven: the old rows went.
        expect(await prisma.demoPaymentHistory.count({ where: { userId } })).toBe(9);
      });

      it('RESTORING TWICE LEAVES THE FIXTURE, NOT TWO OF IT', async () => {
        const { userId } = await scratch();

        await asAdminPost(restorePath(userId));
        const second = await asAdminPost(restorePath(userId));

        expect(second.status).toBe(200);
        expect(await prisma.demoPaymentHistory.count({ where: { userId } })).toBe(9);
        expect(
          await prisma.payee.count({ where: { userId, trust: 'DEMO_SEEDED' } }),
        ).toBe(3);

        const rahuls = await prisma.payee.count({
          where: { userId, displayName: 'Rahul', trust: 'DEMO_SEEDED' },
        });

        expect(rahuls).toBe(1);
      });

      it('reuses a beneficiary the clear had to keep rather than duplicating it', async () => {
        const { userId } = await scratch();

        await asAdminPost(restorePath(userId));

        const rahul = await prisma.payee.findFirst({
          where: { userId, displayName: 'Rahul', trust: 'DEMO_SEEDED' },
        });

        // Something outside this module now refers to Rahul, so the
        // next clear must keep him -- and the next restore must notice.
        await prisma.assistedActivity.create({
          data: {
            userId,
            payeeId: rahul!.id,
            kind: 'PAYMENT_GUIDANCE',
            occurredAt: daysAgo(1),
          },
        });

        const response = await asAdminPost(restorePath(userId));

        expect(response.body.cleared.payeesRetained).toBe(1);
        expect(response.body.payeesReused).toBe(1);
        expect(response.body.payeesCreated).toBe(2);
        expect(
          await prisma.payee.count({ where: { userId, displayName: 'Rahul' } }),
        ).toBe(1);
        // Same row, so the activity still points at a real beneficiary.
        expect(
          await prisma.payee.findUnique({ where: { id: rahul!.id } }),
        ).not.toBeNull();
      });

      it('restores a history the detectors actually recognise', async () => {
        const { userId } = await scratch();

        await asAdminPost(restorePath(userId));

        // No simulated date: the fixture is built around today, which is
        // the whole point of restoring it rather than holding fixed dates.
        const preview = await asAdmin(`/api/admin/demo/customers/${userId}/preview`);

        expect(preview.status).toBe(200);
        expect(preview.body.historyTotal).toBe(9);
        expect(preview.body.recurring.verdict).toBe('MATCHED');
        expect(preview.body.recurring.candidate).toMatchObject({
          type: 'RECURRING_TODAY',
          displayName: 'Rahul',
          amountMinor: 500_000,
          provenance: 'DEMO_HISTORY',
          isBankVerified: false,
        });

        // And the recent payment belongs to someone else, so the two
        // cards cannot collapse into one.
        expect(preview.body.last.verdict).toBe('MATCHED');
        expect(preview.body.last.latestPayeeName).toBe('Priya');
      });

      it('shows no more of an account than its last four digits', async () => {
        const { userId } = await scratch();

        await asAdminPost(restorePath(userId));

        const listed = await asAdmin(`/api/admin/demo/customers/${userId}/payments`);

        expect(JSON.stringify(listed.body)).not.toContain('accountNumber');

        for (const row of listed.body.payments) {
          expect(row.payee.accountLast4).toMatch(/^\d{4}$/);
          expect(row.payee.trust).toBe('DEMO_SEEDED');
        }
      });
    });

    describe('what neither of them may do', () => {
      it('CREATES NO SUGGESTION OFFER AND NO ASSISTED ACTIVITY', async () => {
        const { userId, payeeId } = await scratch();
        await givePayments(userId, payeeId, 2);

        const offersBefore = await prisma.suggestionOffer.count();
        const activitiesBefore = await prisma.assistedActivity.count();

        await asAdminPost(restorePath(userId));
        await asAdminDelete(clearPath(userId));
        await asAdminPost(restorePath(userId));

        // Nothing on this screen may invent a payment, an offer to make
        // one, or a record that one was assisted.
        expect(await prisma.suggestionOffer.count()).toBe(offersBefore);
        expect(await prisma.assistedActivity.count()).toBe(activitiesBefore);
        expect(await prisma.suggestionOffer.count({ where: { userId } })).toBe(0);
        expect(await prisma.assistedActivity.count({ where: { userId } })).toBe(0);
      });

      it('starts no session for the customer', async () => {
        const { userId } = await scratch();

        await asAdminPost(restorePath(userId));
        await asAdminDelete(clearPath(userId));

        expect(await prisma.session.count({ where: { userId } })).toBe(0);
      });

      it('CANNOT REACH ANOTHER CUSTOMER\'S HISTORY', async () => {
        const mine = await scratch();
        const theirs = await scratch();

        await givePayments(theirs.userId, theirs.payeeId, 2);
        await asAdminDelete(clearPath(mine.userId));

        // Clearing one customer is not clearing the dashboard.
        expect(
          await prisma.demoPaymentHistory.count({ where: { userId: theirs.userId } }),
        ).toBe(2);
        expect(await prisma.payee.findUnique({ where: { id: theirs.payeeId } })).not.toBeNull();
      });

      it('never caches what it says', async () => {
        const { userId } = await scratch();

        const restored = await asAdminPost(restorePath(userId));
        const cleared = await asAdminDelete(clearPath(userId));

        expect(restored.headers['cache-control']).toBe('no-store');
        expect(cleared.headers['cache-control']).toBe('no-store');
      });
    });
  });

  describe('the simulated date', () => {
    it('refuses a date it cannot read', async () => {
      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/preview?at=not-a-date`,
      );

      expect(response.status).toBe(400);
    });

    it('refuses a date absurdly far from today', async () => {
      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/preview?at=2099-01-01T00:00:00.000Z`,
      );

      expect(response.status).toBe(422);
    });

    it('rejects a query parameter it does not declare', async () => {
      const response = await asAdmin(
        `/api/admin/demo/customers/${subjectId}/preview?userId=someone-else`,
      );

      expect(response.status).toBe(400);
    });

    it('says plainly when it is using the real present', async () => {
      const response = await asAdmin(`/api/admin/demo/customers/${subjectId}/preview`);

      expect(response.body.isSimulated).toBe(false);
      expect(new Date(response.body.evaluatedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});

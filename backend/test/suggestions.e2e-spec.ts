import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRONG_PASSWORD, createTestApp, uniqueEmail } from './helpers';

/**
 * Remembered payments, end to end.
 *
 * What is being asserted is mostly restraint: that a welcome screen
 * with nothing to say says nothing, that one customer can never see
 * another's beneficiary, that an offer cannot be answered twice, and
 * that no response anywhere carries a full account number -- there is
 * no column for one, and this proves no route invents it.
 *
 * DEMO_HISTORY_ENABLED is true in this environment, so demonstration
 * rows are the history under test. Each one is created for a throwaway
 * account and removed afterwards.
 */
describe('Remembered payment suggestions', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const created: string[] = [];

  const http = () => request(app.getHttpServer());

  interface Customer {
    token: string;
    userId: string;
    sessionId: string;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
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

  /** A signed-in customer, checked in at a branch. */
  async function customer(prefix: string): Promise<Customer> {
    const email = uniqueEmail(prefix);
    created.push(email);

    const registered = await http()
      .post('/api/auth/register')
      .send({ email, fullName: 'E2E Suggestions', password: STRONG_PASSWORD });

    expect(registered.status).toBe(201);

    const token = registered.body.accessToken as string;

    const visit = await http()
      .post('/api/sessions')
      .set('Authorization', 'Bearer ' + token)
      .send({ branchCode: 'BR001' });

    expect(visit.status).toBe(200);

    return { token, userId: registered.body.user.id, sessionId: visit.body.id };
  }

  async function payee(userId: string, displayName: string, last4: string) {
    return prisma.payee.create({
      data: { userId, displayName, accountLast4: last4, trust: 'DEMO_SEEDED' },
    });
  }

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

  /**
   * A monthly habit landing on today, deliberately unpaid this cycle,
   * plus one recent payment to someone else.
   */
  async function giveHistory(userId: string) {
    const today = new Date().getDate();

    const rahul = await payee(userId, 'Rahul', '4821');
    const priya = await payee(userId, 'Priya', '7310');

    await prisma.demoPaymentHistory.createMany({
      data: [
        ...[1, 2, 3, 4].map((months) => ({
          userId,
          payeeId: rahul.id,
          amountMinor: 500_000,
          occurredAt: monthsAgo(months, today),
        })),
        { userId, payeeId: priya.id, amountMinor: 125_000, occurredAt: daysAgo(5) },
      ],
    });

    return { rahul, priya };
  }

  function listFor(person: Customer) {
    return http()
      .get('/api/assistant/suggestions')
      .query({ sessionId: person.sessionId })
      .set('Authorization', 'Bearer ' + person.token);
  }

  it('offers nothing to a customer with no payment history', async () => {
    const person = await customer('suggest-empty');

    const response = await listFor(person);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ suggestions: [] });
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('ignores history that never completed, however much of it there is', async () => {
    // A failed payment is not evidence of anything. A customer whose
    // only history failed must see exactly the welcome screen of a
    // customer with no history at all.
    const person = await customer('suggest-unfinished');
    const today = new Date().getDate();
    const rahul = await payee(person.userId, 'Rahul', '4821');
    const priya = await payee(person.userId, 'Priya', '7310');

    await prisma.demoPaymentHistory.createMany({
      data: [
        ...[1, 2, 3, 4].map((months) => ({
          userId: person.userId,
          payeeId: rahul.id,
          amountMinor: 500_000,
          occurredAt: monthsAgo(months, today),
          status: 'FAILED' as const,
        })),
        {
          userId: person.userId,
          payeeId: priya.id,
          amountMinor: 125_000,
          occurredAt: daysAgo(5),
          status: 'PENDING' as const,
        },
      ],
    });

    const response = await listFor(person);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ suggestions: [] });
  });

  it('does not let a failed payment this month silence the recurring card', async () => {
    // The subtle one. "Already paid this cycle" is what stops the
    // assistant inviting someone to pay their rent twice -- but a
    // payment that FAILED is precisely the case where they still need
    // to pay it. The row must not reach the detector at all.
    const person = await customer('suggest-failed-cycle');
    const { rahul } = await giveHistory(person.userId);

    await prisma.demoPaymentHistory.create({
      data: {
        userId: person.userId,
        payeeId: rahul.id,
        amountMinor: 500_000,
        occurredAt: new Date(),
        status: 'FAILED',
      },
    });

    const response = await listFor(person);

    expect(response.status).toBe(200);
    expect(response.body.suggestions[0]).toMatchObject({
      type: 'RECURRING_TODAY',
      payee: { displayName: 'Rahul' },
      // Still four: the failed attempt is not an occurrence.
      occurrenceCount: 4,
    });
  });

  it('offers the recurring payment first, then the last payment', async () => {
    const person = await customer('suggest-both');
    await giveHistory(person.userId);

    const response = await listFor(person);

    expect(response.status).toBe(200);
    expect(response.body.suggestions).toHaveLength(2);

    const [first, second] = response.body.suggestions;

    expect(first.type).toBe('RECURRING_TODAY');
    expect(first.payee.displayName).toBe('Rahul');
    expect(first.usualDayOfMonth).toBe(new Date().getDate());
    expect(first.occurrenceCount).toBe(4);

    expect(second.type).toBe('LAST_PAYMENT');
    expect(second.payee.displayName).toBe('Priya');
  });

  it('never claims a demonstration record is bank verified', async () => {
    const person = await customer('suggest-provenance');
    await giveHistory(person.userId);

    const response = await listFor(person);

    for (const suggestion of response.body.suggestions) {
      expect(suggestion.provenance).toBe('DEMO_HISTORY');
      expect(suggestion.isBankVerified).toBe(false);
      expect(suggestion.payee.trust).toBe('DEMO_SEEDED');
      expect(suggestion.kind).toBe('PAYMENT_GUIDANCE');
    }
  });

  it('never returns a full account number', async () => {
    const person = await customer('suggest-masked');
    await giveHistory(person.userId);

    const response = await listFor(person);

    expect(JSON.stringify(response.body)).not.toContain('accountNumber');

    for (const suggestion of response.body.suggestions) {
      // An amount is legitimately a long number; a payee's details are
      // not, so the payee is checked rather than the whole payload.
      expect(JSON.stringify(suggestion.payee)).not.toMatch(/\d{5,}/);
      expect(suggestion.payee.accountLast4).toHaveLength(4);
      expect(Object.keys(suggestion.payee).sort()).toEqual([
        'accountLast4',
        'displayName',
        'fullName',
        'trust',
      ]);
    }
  });

  it('refuses an unauthenticated caller', async () => {
    const person = await customer('suggest-anon');

    const response = await http()
      .get('/api/assistant/suggestions')
      .query({ sessionId: person.sessionId });

    expect(response.status).toBe(401);
  });

  it('refuses someone else\'s visit', async () => {
    const mine = await customer('suggest-mine');
    const theirs = await customer('suggest-theirs');

    const response = await http()
      .get('/api/assistant/suggestions')
      .query({ sessionId: theirs.sessionId })
      .set('Authorization', 'Bearer ' + mine.token);

    expect(response.status).toBe(403);
  });

  it('refuses an offer that belongs to someone else', async () => {
    const owner = await customer('suggest-owner');
    await giveHistory(owner.userId);
    const offers = await listFor(owner);
    const offerId = offers.body.suggestions[0].id;

    const intruder = await customer('suggest-intruder');

    const response = await http()
      .post(`/api/assistant/suggestions/${offerId}/continue`)
      .set('Authorization', 'Bearer ' + intruder.token)
      .send({});

    expect(response.status).toBe(403);
  });

  it('opens an activity for review, and refuses a second answer to the same offer', async () => {
    const person = await customer('suggest-continue');
    const { rahul } = await giveHistory(person.userId);

    const offers = await listFor(person);
    const offer = offers.body.suggestions[0];

    const accepted = await http()
      .post(`/api/assistant/suggestions/${offer.id}/continue`)
      .set('Authorization', 'Bearer ' + person.token)
      .send({});

    expect(accepted.status).toBe(200);
    expect(accepted.body.review.payee.displayName).toBe('Rahul');
    expect(accepted.body.review.amountMinor).toBe(500_000);
    expect(accepted.body.review.isBankVerified).toBe(false);

    const activity = await prisma.assistedActivity.findUnique({
      where: { id: accepted.body.activityId },
    });

    // Opened for review, and nothing more: accepting is not confirming.
    expect(activity?.status).toBe('STARTED');
    expect(activity?.kind).toBe('PAYMENT_GUIDANCE');
    expect(activity?.payeeId).toBe(rahul.id);
    expect(activity?.confirmedAt).toBeNull();

    const again = await http()
      .post(`/api/assistant/suggestions/${offer.id}/continue`)
      .set('Authorization', 'Bearer ' + person.token)
      .send({});

    expect(again.status).toBe(410);
  });

  it('refuses to continue a recurring payment already made this cycle', async () => {
    const person = await customer('suggest-already-paid');
    const { rahul } = await giveHistory(person.userId);

    const offers = await listFor(person);
    const recurring = offers.body.suggestions.find(
      (item: { type: string }) => item.type === 'RECURRING_TODAY',
    );

    // Paid in the meantime, between the screen being drawn and the tap.
    await prisma.demoPaymentHistory.create({
      data: { userId: person.userId, payeeId: rahul.id, amountMinor: 500_000, occurredAt: new Date() },
    });

    const response = await http()
      .post(`/api/assistant/suggestions/${recurring.id}/continue`)
      .set('Authorization', 'Bearer ' + person.token)
      .send({});

    expect(response.status).toBe(409);
  });

  it('stops offering a payee the customer has declined twice', async () => {
    const person = await customer('suggest-declined');
    await giveHistory(person.userId);

    for (let round = 0; round < 2; round += 1) {
      const offers = await listFor(person);
      const recurring = offers.body.suggestions.find(
        (item: { type: string }) => item.type === 'RECURRING_TODAY',
      );

      expect(recurring).toBeDefined();

      const declined = await http()
        .post(`/api/assistant/suggestions/${recurring.id}/decline`)
        .set('Authorization', 'Bearer ' + person.token)
        .send({});

      expect(declined.status).toBe(204);
    }

    const after = await listFor(person);
    const types = after.body.suggestions.map((item: { type: string }) => item.type);

    expect(types).not.toContain('RECURRING_TODAY');
  });

  it('offers nothing once the customer turns suggestions off', async () => {
    const person = await customer('suggest-toggle');
    await giveHistory(person.userId);

    expect((await listFor(person)).body.suggestions.length).toBeGreaterThan(0);

    const updated = await http()
      .patch('/api/auth/me')
      .set('Authorization', 'Bearer ' + person.token)
      .send({ suggestionsEnabled: false });

    expect(updated.status).toBe(200);

    expect((await listFor(person)).body).toEqual({ suggestions: [] });
  });
});

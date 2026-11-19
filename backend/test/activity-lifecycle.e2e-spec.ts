import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiEngineClient } from '../src/assistant/engine/ai-engine.client';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRONG_PASSWORD, createTestApp, uniqueEmail } from './helpers';

/**
 * The life of an assisted activity.
 *
 * THE RULE THIS SUITE EXISTS FOR: finishing a workflow is not a
 * payment. The engine reports a workflow state, this backend records
 * that the GUIDANCE finished, and nothing anywhere claims money moved.
 *
 * The engine is replaced so the workflow state can be driven exactly.
 * Whether the real engine completes a workflow is the Python suite's
 * question; whether this backend believes the right thing about it is
 * this one's.
 */
class StateEngine extends AiEngineClient {
  /** What the next reply's snapshot will report. */
  state: string = 'active';
  workflowName: string | null = 'deposit money';

  async sendText(turn: { sessionId: string; language: string; text: string }) {
    return {
      reply: 'echo:' + turn.text,
      workflow: { name: this.workflowName, state: this.state, step: 2, totalSteps: 4 },
      ended: false,
    };
  }

  async sendAudio() {
    return { reply: 'spoken', workflow: null, ended: false };
  }

  async synthesize() {
    return { audio: Buffer.from('ID3   '), contentType: 'audio/mpeg' };
  }

  async endSession() {
    // Nothing to release: this fake holds no conversation.
  }
}

describe('Assisted activity lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const engine = new StateEngine();

  const created: string[] = [];

  const http = () => request(app.getHttpServer());

  interface Customer {
    token: string;
    userId: string;
    sessionId: string;
    payeeId: string;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({
      overrides: [{ token: AiEngineClient, value: engine }],
    }));
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

  beforeEach(() => {
    engine.state = 'active';
    engine.workflowName = 'deposit money';
  });

  /** A checked-in customer with one payee and one payment behind them. */
  async function customer(prefix: string): Promise<Customer> {
    const email = uniqueEmail(prefix);
    created.push(email);

    const registered = await http()
      .post('/api/auth/register')
      .send({ email, fullName: 'E2E Activity', password: STRONG_PASSWORD });

    const token = registered.body.accessToken as string;
    const userId = registered.body.user.id as string;

    const visit = await http()
      .post('/api/sessions')
      .set('Authorization', 'Bearer ' + token)
      .send({ branchCode: 'BR001' });

    const payee = await prisma.payee.create({
      data: { userId, displayName: 'Rahul', accountLast4: '4821', trust: 'DEMO_SEEDED' },
    });

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await prisma.demoPaymentHistory.create({
      data: { userId, payeeId: payee.id, amountMinor: 500_000, occurredAt: fiveDaysAgo },
    });

    return { token, userId, sessionId: visit.body.id, payeeId: payee.id };
  }

  /** Takes the last-payment suggestion as far as an open activity. */
  async function openActivity(person: Customer): Promise<string> {
    const offers = await http()
      .get('/api/assistant/suggestions')
      .query({ sessionId: person.sessionId })
      .set('Authorization', 'Bearer ' + person.token);

    expect(offers.body.suggestions.length).toBeGreaterThan(0);

    const accepted = await http()
      .post(`/api/assistant/suggestions/${offers.body.suggestions[0].id}/continue`)
      .set('Authorization', 'Bearer ' + person.token)
      .send({});

    expect(accepted.status).toBe(200);

    return accepted.body.activityId as string;
  }

  function confirm(person: Customer, activityId: string, body: object = {}) {
    return http()
      .post(`/api/assistant/activities/${activityId}/confirm`)
      .set('Authorization', 'Bearer ' + person.token)
      .send(body);
  }

  function turn(person: Customer, text: string) {
    return http()
      .post('/api/assistant/message')
      .set('Authorization', 'Bearer ' + person.token)
      .send({ sessionId: person.sessionId, text });
  }

  it('confirms the customer\'s choice and hands them to the assistant', async () => {
    const person = await customer('activity-confirm');
    const activityId = await openActivity(person);

    const response = await confirm(person, activityId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      activityId,
      status: 'CONFIRMED',
      handOver: { requestKey: 'PAYMENT' },
    });

    // Confirming is a recorded intention, not a payment.
    const row = await prisma.assistedActivity.findUnique({ where: { id: activityId } });
    expect(row?.status).toBe('CONFIRMED');
    expect(row?.completedAt).toBeNull();
  });

  it('is idempotent: confirming twice creates one activity, not two', async () => {
    const person = await customer('activity-idempotent');
    const activityId = await openActivity(person);

    const first = await confirm(person, activityId);
    const second = await confirm(person, activityId);

    expect(first.body.activityId).toBe(second.body.activityId);

    const confirmed = await prisma.assistedActivity.count({
      where: { userId: person.userId, status: 'CONFIRMED' },
    });

    expect(confirmed).toBe(1);
  });

  it('refuses an amount above the configured ceiling', async () => {
    const person = await customer('activity-ceiling');
    const activityId = await openActivity(person);

    const response = await confirm(person, activityId, { amountMinor: 99_999_999 });

    expect(response.status).toBe(400);
  });

  it('refuses a payee belonging to someone else', async () => {
    const person = await customer('activity-own-payee');
    const stranger = await customer('activity-stranger');
    const activityId = await openActivity(person);

    const response = await confirm(person, activityId, { payeeId: stranger.payeeId });

    expect(response.status).toBe(403);
  });

  it('records completed GUIDANCE when the engine says the workflow completed', async () => {
    const person = await customer('activity-completed');
    const activityId = await openActivity(person);
    await confirm(person, activityId);

    engine.state = 'completed';
    engine.workflowName = 'deposit money';

    const reply = await turn(person, 'done');
    expect(reply.status).toBe(200);

    const row = await prisma.assistedActivity.findUnique({ where: { id: activityId } });

    // The instructions finished. That is the entire claim.
    expect(row?.status).toBe('GUIDANCE_COMPLETED');
    expect(row?.completedAt).not.toBeNull();
    expect(row?.workflowName).toBe('deposit money');
  });

  it('leaves the activity open while the workflow is still running', async () => {
    const person = await customer('activity-active');
    const activityId = await openActivity(person);
    await confirm(person, activityId);

    engine.state = 'active';
    await turn(person, 'what next');

    const row = await prisma.assistedActivity.findUnique({ where: { id: activityId } });

    expect(row?.status).toBe('CONFIRMED');
    expect(row?.completedAt).toBeNull();
  });

  it('writes no history when the workflow is cancelled', async () => {
    const person = await customer('activity-cancelled');
    const activityId = await openActivity(person);
    await confirm(person, activityId);

    engine.state = 'cancelled';
    await turn(person, 'cancel that');

    const row = await prisma.assistedActivity.findUnique({ where: { id: activityId } });

    expect(row?.status).toBe('CANCELLED');
    expect(row?.completedAt).toBeNull();

    // And nothing cancelled may ever become remembered history.
    const remembered = await prisma.assistedActivity.count({
      where: { userId: person.userId, status: 'GUIDANCE_COMPLETED' },
    });

    expect(remembered).toBe(0);
  });

  it('shows the customer their own record, and forgets it on request', async () => {
    const person = await customer('activity-history');
    const activityId = await openActivity(person);
    await confirm(person, activityId);

    engine.state = 'completed';
    await turn(person, 'done');

    const history = await http()
      .get('/api/me/activities')
      .set('Authorization', 'Bearer ' + person.token);

    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      kind: 'PAYMENT_GUIDANCE',
      status: 'GUIDANCE_COMPLETED',
      payee: { displayName: 'Rahul', accountLast4: '4821' },
    });

    const forgotten = await http()
      .delete('/api/me/activities')
      .set('Authorization', 'Bearer ' + person.token);

    expect(forgotten.status).toBe(200);
    expect(forgotten.body.deleted).toBeGreaterThan(0);

    const after = await http()
      .get('/api/me/activities')
      .set('Authorization', 'Bearer ' + person.token);

    expect(after.body).toEqual([]);
  });

  it('never reports a full account number on the review screen', async () => {
    const person = await customer('activity-masked');
    const activityId = await openActivity(person);

    const review = await http()
      .get(`/api/assistant/activities/${activityId}`)
      .set('Authorization', 'Bearer ' + person.token);

    expect(review.status).toBe(200);
    expect(JSON.stringify(review.body)).not.toContain('accountNumber');
    expect(review.body.review.isBankVerified).toBe(false);
    expect(review.body.review.payee.accountLast4).toBe('4821');
  });
});

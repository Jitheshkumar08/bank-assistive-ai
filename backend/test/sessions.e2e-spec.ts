import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRONG_PASSWORD, createTestApp, uniqueEmail } from './helpers';

describe('Branch context and sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  const created: string[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    const email = uniqueEmail('sessions');
    created.push(email);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, fullName: 'Session Tester', password: STRONG_PASSWORD });

    token = res.body.accessToken;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { email: { in: created } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = () => `Bearer ${token}`;

  beforeEach(async () => {
    await prisma.session.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date(), activeUserId: null },
    });
  });

  describe('establishing context', () => {
    it('creates a visit from a valid branch', async () => {
      const res = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      expect(res.status).toBe(200);
      expect(res.body.branch.code).toBe('BR001');
      expect(res.body.status).toBe('ACTIVE');
    });

    it('moves the existing visit instead of starting a second one', async () => {
      const first = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      const second = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR002' });

      // Scanning again -- even in another branch -- is still one visit.
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.branch.code).toBe('BR002');
      expect(await prisma.session.count({ where: { userId, status: 'ACTIVE' } })).toBe(1);
    });

    it('never opens two active visits, even under concurrent scans', async () => {
      const scans = Array.from({ length: 10 }, (_, i) =>
        http()
          .post('/api/sessions')
          .set('Authorization', bearer())
          .send({ branchCode: 'BR001' }),
      );

      const results = await Promise.all(scans);
      const ids = new Set(results.filter((r) => r.status === 200).map((r) => r.body.id));

      expect(ids.size).toBe(1);
      expect(await prisma.session.count({ where: { userId, status: 'ACTIVE' } })).toBe(1);
    });

    it('gives the visit the language the account was registered with', async () => {
      const kannadaEmail = uniqueEmail('kannada');
      created.push(kannadaEmail);

      const registered = await http()
        .post('/api/auth/register')
        .send({
          email: kannadaEmail,
          fullName: 'Kannada Speaker',
          password: STRONG_PASSWORD,
          preferredLanguage: 'kn',
        });

      const visit = await http()
        .post('/api/sessions')
        .set('Authorization', `Bearer ${registered.body.accessToken}`)
        .send({ branchCode: 'BR001' });

      // Speech is language-sensitive: a visit that always claimed 'en'
      // would have transcribed this customer as an English speaker.
      expect(visit.body.language).toBe('kn');

      await prisma.session.deleteMany({ where: { userId: registered.body.user.id } });
    });

    it('still defaults English speakers to English', async () => {
      const res = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      expect(res.body.language).toBe('en');
    });

    it('does not change the language of a visit already in progress', async () => {
      const first = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      await prisma.user.update({
        where: { id: userId },
        data: { preferredLanguage: 'hi' },
      });

      const moved = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      // Walking to another counter must not switch language mid-visit.
      expect(moved.body.id).toBe(first.body.id);
      expect(moved.body.language).toBe('en');

      await prisma.user.update({ where: { id: userId }, data: { preferredLanguage: 'en' } });
    });


    it.each([
      ['unknown branch', { branchCode: 'BR999' }, 404],
      ['missing branch', {}, 400],
      ['unknown property', { branchCode: 'BR001', userId: 'x' }, 400],
      [
        'injection characters',
        { branchCode: 'BR001; DROP TABLE users' },
        400,
      ],
    ])('rejects %s', async (_label, body, expected) => {
      const res = await http().post('/api/sessions').set('Authorization', bearer()).send(body);
      expect(res.status).toBe(expected);
    });
  });

  describe('ending a visit', () => {
    it('ends only the callers own visit', async () => {
      const other = uniqueEmail('intruder');
      created.push(other);

      const otherUser = await http()
        .post('/api/auth/register')
        .send({ email: other, fullName: 'Other Person', password: STRONG_PASSWORD });

      const mine = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      const attempt = await http()
        .post(`/api/sessions/${mine.body.id}/end`)
        .set('Authorization', `Bearer ${otherUser.body.accessToken}`);

      expect(attempt.status).toBe(404);

      const stillActive = await http().get('/api/sessions/active').set('Authorization', bearer());
      expect(stillActive.body.id).toBe(mine.body.id);
    });

    it('marks the visit ended and frees the slot for a new one', async () => {
      const visit = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      const ended = await http()
        .post(`/api/sessions/${visit.body.id}/end`)
        .set('Authorization', bearer());

      expect(ended.status).toBe(200);
      expect(ended.body.status).toBe('ENDED');
      expect(ended.body.endedAt).not.toBeNull();

      const next = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR002' });

      expect(next.body.id).not.toBe(visit.body.id);
    });

    it('is safe to end the same visit twice', async () => {
      const visit = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      const first = await http()
        .post(`/api/sessions/${visit.body.id}/end`)
        .set('Authorization', bearer());
      const second = await http()
        .post(`/api/sessions/${visit.body.id}/end`)
        .set('Authorization', bearer());

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it('rejects a malformed id', async () => {
      const res = await http().post('/api/sessions/not-a-uuid/end').set('Authorization', bearer());
      expect(res.status).toBe(400);
    });
  });

});

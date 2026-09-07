import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRONG_PASSWORD, createTestApp, uniqueEmail } from './helpers';

describe('Authentication', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const created: string[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    if (created.length) {
      await prisma.user.deleteMany({ where: { email: { in: created } } });
    }
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function register(email: string) {
    created.push(email);
    return http()
      .post('/api/auth/register')
      .send({ email, fullName: 'E2E User', password: STRONG_PASSWORD });
  }

  describe('registration', () => {
    it('creates an account and returns a token without the password hash', async () => {
      const email = uniqueEmail('register');
      const res = await register(email);

      expect(res.status).toBe(201);
      expect(res.body.accessToken.split('.')).toHaveLength(3);
      expect(res.body.user.email).toBe(email);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/i);
    });

    it('rejects a duplicate email', async () => {
      const email = uniqueEmail('dupe');
      await register(email);

      const res = await http()
        .post('/api/auth/register')
        .send({ email, fullName: 'Someone Else', password: STRONG_PASSWORD });

      expect(res.status).toBe(409);
    });

    it('rejects a short password', async () => {
      const res = await http()
        .post('/api/auth/register')
        .send({ email: uniqueEmail('short'), fullName: 'X Y', password: 'short' });

      expect(res.status).toBe(400);
    });

    it('rejects unknown properties rather than ignoring them', async () => {
      const res = await http().post('/api/auth/register').send({
        email: uniqueEmail('extra'),
        fullName: 'X Y',
        password: STRONG_PASSWORD,
        isAdmin: true,
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('isAdmin');
    });

    it('normalises the email so sign-in is case-insensitive', async () => {
      const email = uniqueEmail('Case').toUpperCase();
      created.push(email.toLowerCase());

      const registered = await http()
        .post('/api/auth/register')
        .send({ email, fullName: 'Case Test', password: STRONG_PASSWORD });
      expect(registered.status).toBe(201);

      const res = await http()
        .post('/api/auth/login')
        .send({ email: email.toLowerCase(), password: STRONG_PASSWORD });
      expect(res.status).toBe(200);
    });
  });

  describe('login', () => {
    it('accepts correct credentials', async () => {
      const email = uniqueEmail('login-ok');
      await register(email);

      const res = await http().post('/api/auth/login').send({ email, password: STRONG_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const email = uniqueEmail('enumerate');
      await register(email);

      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ email, password: 'WrongPassword!' });

      const unknownAccount = await http()
        .post('/api/auth/login')
        .send({ email: uniqueEmail('ghost'), password: 'WrongPassword!' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownAccount.status).toBe(401);
      // If these ever diverge, the API starts telling attackers which
      // email addresses are registered.
      expect(wrongPassword.body.message).toBe(unknownAccount.body.message);
    });

    it('refuses a deactivated account', async () => {
      const email = uniqueEmail('deactivated');
      await register(email);
      await prisma.user.update({ where: { email }, data: { isActive: false } });

      const res = await http().post('/api/auth/login').send({ email, password: STRONG_PASSWORD });

      expect(res.status).toBe(401);
    });
  });

  describe('token handling', () => {
    it('revokes access immediately when the account is deactivated', async () => {
      const email = uniqueEmail('revoke');
      const registered = await register(email);
      const token = registered.body.accessToken as string;

      const before = await http().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);

      await prisma.user.update({ where: { email }, data: { isActive: false } });

      // The token is still cryptographically valid; the strategy
      // re-reads the user, which is what makes this work.
      const after = await http().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(401);
    });

    it.each([
      ['no header', undefined],
      ['garbage token', 'Bearer not.a.token'],
      ['wrong scheme', 'Basic abcdef'],
      ['empty bearer', 'Bearer '],
    ])('rejects %s', async (_label, header) => {
      const req = http().get('/api/auth/me');
      if (header) req.set('Authorization', header);

      expect((await req).status).toBe(401);
    });

    it('rejects a token whose signature has been tampered with', async () => {
      const email = uniqueEmail('tamper');
      const registered = await register(email);
      const token = registered.body.accessToken as string;
      const forged = `${token.split('.').slice(0, 2).join('.')}.badsignature`;

      const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${forged}`);

      expect(res.status).toBe(401);
    });
  });

  describe('route protection', () => {
    it.each([
      ['/api/branches', 'get'],
      ['/api/sessions/active', 'get'],
      ['/api/auth/me', 'get'],
    ])('closes %s to anonymous callers', async (path, method) => {
      const res = await (http() as never as Record<string, (p: string) => request.Test>)[method](
        path,
      );
      expect(res.status).toBe(401);
    });

    it('leaves the health check open', async () => {
      const res = await http().get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});

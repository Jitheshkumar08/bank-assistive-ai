import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRONG_PASSWORD, createTestApp, uniqueEmail } from './helpers';

/**
 * Changing your own account details.
 *
 * The rules being pinned here are security rules, not conveniences: a
 * password change must prove the old password, an email change must too,
 * and neither may ever be performed on somebody else's account.
 */
describe('Account settings', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const created: string[] = [];

  let token: string;
  let userId: string;
  let email: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    if (created.length) {
      await prisma.session.deleteMany({ where: { user: { email: { in: created } } } });
      await prisma.user.deleteMany({ where: { email: { in: created } } });
    }
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = () => `Bearer ${token}`;

  // A fresh account per test: these tests change credentials, and
  // sharing one would make them order-dependent.
  beforeEach(async () => {
    email = uniqueEmail('account');
    created.push(email);

    const res = await http()
      .post('/api/auth/register')
      .send({ email, fullName: 'Original Name', password: STRONG_PASSWORD });

    token = res.body.accessToken;
    userId = res.body.user.id;
  });

  describe('authentication', () => {
    it('refuses an anonymous profile change', async () => {
      const res = await http().patch('/api/auth/me').send({ fullName: 'Intruder' });

      expect(res.status).toBe(401);
    });

    it('refuses an anonymous password change', async () => {
      const res = await http()
        .patch('/api/auth/me/password')
        .send({ currentPassword: STRONG_PASSWORD, newPassword: 'NewStrongPass123!' });

      expect(res.status).toBe(401);
    });

    it('changes only the caller, whatever the body says', async () => {
      const otherEmail = uniqueEmail('bystander');
      created.push(otherEmail);

      const other = await http()
        .post('/api/auth/register')
        .send({ email: otherEmail, fullName: 'Bystander', password: STRONG_PASSWORD });

      // A body carrying somebody else's id must not redirect the change.
      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ fullName: 'Renamed', id: other.body.user.id, userId: other.body.user.id });

      // Unknown properties are rejected outright, which is the stronger
      // of the two acceptable outcomes.
      expect(res.status).toBe(400);

      const bystander = await prisma.user.findUniqueOrThrow({
        where: { id: other.body.user.id },
        select: { fullName: true },
      });
      expect(bystander.fullName).toBe('Bystander');
    });
  });

  describe('changing a name', () => {
    it('saves the new name and returns it', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ fullName: 'Anita Rao' });

      expect(res.status).toBe(200);
      expect(res.body.user.fullName).toBe('Anita Rao');

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(stored.fullName).toBe('Anita Rao');
    });

    it('does not ask for a password to change a name', async () => {
      // Friction with nothing behind it: a name is not the account's
      // identity and cannot be used to take it over.
      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ fullName: 'No Password Needed' });

      expect(res.status).toBe(200);
    });

    it.each([
      ['a name that is too short', { fullName: 'A' }],
      ['an unknown property', { nickname: 'x' }],
      ['a language with no voice', { preferredLanguage: 'ta' }],
    ])('rejects %s', async (_label, body) => {
      const res = await http().patch('/api/auth/me').set('Authorization', bearer()).send(body);

      expect(res.status).toBe(400);
    });
  });

  describe('changing a language', () => {
    it('saves the choice', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ preferredLanguage: 'kn' });

      expect(res.status).toBe(200);
      expect(res.body.user.preferredLanguage).toBe('kn');
    });

    it('moves the visit in progress to the new language', async () => {
      const visit = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      expect(visit.body.language).toBe('en');

      await http().patch('/api/auth/me').set('Authorization', bearer()).send({
        preferredLanguage: 'kn',
      });

      // The customer asked for Kannada. An assistant that kept speaking
      // English until their next visit would read as a broken setting.
      const active = await http().get('/api/sessions/active').set('Authorization', bearer());
      expect(active.body.language).toBe('kn');
    });

    it('leaves an ended visit alone', async () => {
      const visit = await http()
        .post('/api/sessions')
        .set('Authorization', bearer())
        .send({ branchCode: 'BR001' });

      await http().post(`/api/sessions/${visit.body.id}/end`).set('Authorization', bearer());

      await http().patch('/api/auth/me').set('Authorization', bearer()).send({
        preferredLanguage: 'hi',
      });

      // History is history; rewriting what language a finished visit was
      // conducted in would be a lie.
      const ended = await prisma.session.findUniqueOrThrow({ where: { id: visit.body.id } });
      expect(ended.language).toBe('en');
    });
  });

  describe('changing an email', () => {
    it('requires the current password', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ email: uniqueEmail('moved') });

      // An unattended phone must not be enough to point the account at
      // somebody else.
      expect(res.status).toBe(400);
    });

    it('refuses a wrong password', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ email: uniqueEmail('moved'), currentPassword: 'NotThePassword1!' });

      expect(res.status).toBe(401);
    });

    it('changes the address when the password is right', async () => {
      const next = uniqueEmail('moved');
      created.push(next);

      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ email: next, currentPassword: STRONG_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(next);

      // The new address is what signs in from now on.
      const signIn = await http()
        .post('/api/auth/login')
        .send({ email: next, password: STRONG_PASSWORD });
      expect(signIn.status).toBe(200);

      const old = await http()
        .post('/api/auth/login')
        .send({ email, password: STRONG_PASSWORD });
      expect(old.status).toBe(401);
    });

    it('returns a token that matches the new address', async () => {
      const next = uniqueEmail('moved');
      created.push(next);

      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ email: next, currentPassword: STRONG_PASSWORD });

      const claims = JSON.parse(
        Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString(),
      );

      // A token still claiming the old address is the kind of mismatch
      // that surfaces months later.
      expect(claims.email).toBe(next);
    });

    it('refuses an address somebody else already uses', async () => {
      const takenEmail = uniqueEmail('taken');
      created.push(takenEmail);

      await http()
        .post('/api/auth/register')
        .send({ email: takenEmail, fullName: 'Existing', password: STRONG_PASSWORD });

      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ email: takenEmail, currentPassword: STRONG_PASSWORD });

      expect(res.status).toBe(409);
    });

    it('accepts the address the account already has, without a password', async () => {
      // Submitting an unchanged form is not an email change, and should
      // not demand a password or collide with the unique index.
      const res = await http()
        .patch('/api/auth/me')
        .set('Authorization', bearer())
        .send({ email, fullName: 'Same Email New Name' });

      expect(res.status).toBe(200);
      expect(res.body.user.fullName).toBe('Same Email New Name');
    });
  });

  describe('changing a password', () => {
    const NEW_PASSWORD = 'EvenStronger456!';

    it('requires the current one', async () => {
      const res = await http()
        .patch('/api/auth/me/password')
        .set('Authorization', bearer())
        .send({ currentPassword: 'WrongPassword1!', newPassword: NEW_PASSWORD });

      expect(res.status).toBe(401);
    });

    it('replaces the password when the current one is right', async () => {
      const res = await http()
        .patch('/api/auth/me/password')
        .set('Authorization', bearer())
        .send({ currentPassword: STRONG_PASSWORD, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);

      const withNew = await http()
        .post('/api/auth/login')
        .send({ email, password: NEW_PASSWORD });
      expect(withNew.status).toBe(200);

      // The whole point: the old password stops working.
      const withOld = await http()
        .post('/api/auth/login')
        .send({ email, password: STRONG_PASSWORD });
      expect(withOld.status).toBe(401);
    });

    it('stores a hash, never the password', async () => {
      await http()
        .patch('/api/auth/me/password')
        .set('Authorization', bearer())
        .send({ currentPassword: STRONG_PASSWORD, newPassword: NEW_PASSWORD });

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain(NEW_PASSWORD);
    });

    it('never returns the hash', async () => {
      const res = await http()
        .patch('/api/auth/me/password')
        .set('Authorization', bearer())
        .send({ currentPassword: STRONG_PASSWORD, newPassword: NEW_PASSWORD });

      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/i);
    });

    it.each([
      ['a new password that is too short', { currentPassword: STRONG_PASSWORD, newPassword: 'short' }],
      ['a missing current password', { newPassword: 'EvenStronger456!' }],
      ['a missing new password', { currentPassword: STRONG_PASSWORD }],
    ])('rejects %s', async (_label, body) => {
      const res = await http()
        .patch('/api/auth/me/password')
        .set('Authorization', bearer())
        .send(body);

      expect(res.status).toBe(400);
    });
  });
});

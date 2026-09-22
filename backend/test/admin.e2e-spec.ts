import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRONG_PASSWORD, createTestApp, uniqueEmail } from './helpers';

/**
 * The staff screen's API.
 *
 * The admin account is the one named by ADMIN_EMAIL: the application
 * creates it and gives it the ADMIN role on boot, which is the only way
 * that role is ever granted.
 */
describe('Admin branches', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerToken: string;

  const createdBranchCodes: string[] = [];
  const createdEmails: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => 'Bearer ' + token;
  const uniqueCode = (prefix: string) =>
    prefix + (Date.now() % 100000) + Math.floor(Math.random() * 100);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    const adminLogin = await http().post('/api/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken;

    const email = uniqueEmail('admin-customer');
    createdEmails.push(email);

    const customer = await http()
      .post('/api/auth/register')
      .send({ email, fullName: 'E2E Customer', password: STRONG_PASSWORD });

    customerToken = customer.body.accessToken;
  });

  afterAll(async () => {
    if (createdBranchCodes.length) {
      await prisma.session.deleteMany({
        where: { branch: { code: { in: createdBranchCodes } } },
      });
      await prisma.branch.deleteMany({ where: { code: { in: createdBranchCodes } } });
    }
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
  });

  async function createBranch(body: Record<string, unknown>) {
    if (typeof body.code === 'string') createdBranchCodes.push(body.code.toUpperCase());

    return http().post('/api/admin/branches').set('Authorization', bearer(adminToken)).send(body);
  }

  describe('who may reach it', () => {
    it('refuses anonymous callers', async () => {
      const res = await http().get('/api/admin/branches');

      expect(res.status).toBe(401);
    });

    it('refuses a signed-in customer', async () => {
      const res = await http()
        .get('/api/admin/branches')
        .set('Authorization', bearer(customerToken));

      // 403, not a list: the customer is known, and simply not allowed.
      expect(res.status).toBe(403);
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('lets the admin account in', async () => {
      const res = await http().get('/api/admin/branches').set('Authorization', bearer(adminToken));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('the role on the account itself', () => {
    it('marks the admin as ADMIN and a customer as CUSTOMER', async () => {
      const admin = await http().get('/api/auth/me').set('Authorization', bearer(adminToken));
      const customer = await http().get('/api/auth/me').set('Authorization', bearer(customerToken));

      expect(admin.body.role).toBe('ADMIN');
      expect(customer.body.role).toBe('CUSTOMER');
    });
  });

  describe('creating a branch', () => {
    it('stores the code uppercase and starts with no visits', async () => {
      const code = uniqueCode('e2e');
      const res = await createBranch({ code, name: 'E2E Test Branch', city: 'Mangaluru' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        code: code.toUpperCase(),
        name: 'E2E Test Branch',
        city: 'Mangaluru',
        isActive: true,
        totalVisits: 0,
        activeVisits: 0,
        lastVisitAt: null,
      });
    });

    it('refuses a code the scanner could not read', async () => {
      const res = await createBranch({ code: 'no spaces allowed', name: 'Bad Code Branch' });

      expect(res.status).toBe(400);
    });

    it('refuses a code that already exists', async () => {
      const code = uniqueCode('dup');
      await createBranch({ code, name: 'First Branch' });

      const second = await createBranch({ code, name: 'Second Branch' });

      expect(second.status).toBe(409);
    });
  });

  describe('changing a branch', () => {
    it('renames it and can take it out of service', async () => {
      const code = uniqueCode('edit');
      const created = await createBranch({ code, name: 'Before Rename' });

      const res = await http()
        .patch('/api/admin/branches/' + created.body.id)
        .set('Authorization', bearer(adminToken))
        .send({ name: 'After Rename', isActive: false });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'After Rename', isActive: false });

      // A deactivated branch disappears from what customers can resolve.
      const publicList = await http()
        .get('/api/branches')
        .set('Authorization', bearer(customerToken));
      const codes = publicList.body.map((branch: { code: string }) => branch.code);
      expect(codes).not.toContain(code.toUpperCase());
    });

    it('refuses to change the code, which is printed on the QR already', async () => {
      const code = uniqueCode('fixed');
      const created = await createBranch({ code, name: 'Fixed Code Branch' });

      const res = await http()
        .patch('/api/admin/branches/' + created.body.id)
        .set('Authorization', bearer(adminToken))
        .send({ code: 'SOMETHINGELSE' });

      expect(res.status).toBe(400);
    });
  });

  describe('deleting a branch', () => {
    it('removes one nobody has visited', async () => {
      const code = uniqueCode('del');
      const created = await createBranch({ code, name: 'Unused Branch' });

      const res = await http()
        .delete('/api/admin/branches/' + created.body.id)
        .set('Authorization', bearer(adminToken));

      expect(res.status).toBe(204);

      const after = await http()
        .get('/api/admin/branches/' + created.body.id)
        .set('Authorization', bearer(adminToken));
      expect(after.status).toBe(404);
    });

    it('keeps one that has visits, and says to deactivate it instead', async () => {
      const code = uniqueCode('used');
      const created = await createBranch({ code, name: 'Visited Branch' });

      // A visit, made the way the app makes one.
      const email = uniqueEmail('admin-visitor');
      createdEmails.push(email);
      const visitor = await http()
        .post('/api/auth/register')
        .send({ email, fullName: 'E2E Visitor', password: STRONG_PASSWORD });

      const visit = await http()
        .post('/api/sessions')
        .set('Authorization', bearer(visitor.body.accessToken))
        .send({ branchCode: code.toUpperCase() });
      expect(visit.status).toBe(200);

      const res = await http()
        .delete('/api/admin/branches/' + created.body.id)
        .set('Authorization', bearer(adminToken));

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/deactivate/i);
    });
  });

  describe('the overview', () => {
    it('counts branches, customers and visits', async () => {
      const res = await http().get('/api/admin/overview').set('Authorization', bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.branches.total).toBeGreaterThanOrEqual(res.body.branches.active);
      // The admin is not a customer, and the customer registered above is.
      expect(res.body.customers).toBeGreaterThanOrEqual(1);
      expect(res.body.visits.active).toBeGreaterThanOrEqual(0);
      expect(res.body.visits.today).toBeGreaterThanOrEqual(0);
    });
  });
});

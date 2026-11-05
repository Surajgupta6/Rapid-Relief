/**
 * tests/integration/admin.test.js
 *
 * Integration tests for the admin API.
 * Covers: listDrivers, verifyDriver, revokeDriver, getStats,
 *         listStaleBookings, forceCancelBooking, listStaleDrivers.
 * Also covers that non-admin users are blocked (403).
 */
'use strict';

const request = require('supertest');
const { app } = require('../../src/app');
const db = require('../setup/db');
const {
  DEFAULT_PASSWORD,
  createUser,
  createHospital,
  createDriver,
  createBooking
} = require('../setup/helpers');

let hospital;

beforeAll(async () => {
  await db.connect();
  hospital = await createHospital();
});
afterEach(async () => { await db.clearDatabase(); hospital = await createHospital(); });
afterAll(async () => { await db.disconnect(); });

async function loginAs(email) {
  const agent = request.agent(app);
  await agent.post('/auth/login').send({ email, password: DEFAULT_PASSWORD });
  return agent;
}

// ── Authorization guard ────────────────────────────────────────────────────────
describe('Admin route authorization', () => {
  test('403 — regular user cannot access admin routes', async () => {
    const user = await createUser({ email: 'regular@test.com' });
    const agent = await loginAs(user.email);
    const res = await agent.get('/api/admin/stats');
    expect(res.status).toBe(403);
  });

  test('401 — unauthenticated request is rejected', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/stats ───────────────────────────────────────────────────────
describe('GET /api/admin/stats', () => {
  test('200 — admin receives platform statistics', async () => {
    const admin = await createUser({ email: 'admin@test.com', role: 'admin' });
    await createDriver(hospital, { user: { email: 'drv_stats@test.com' } });
    const agent = await loginAs(admin.email);

    const res = await agent.get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.drivers).toBeDefined();
    expect(res.body.data.bookings).toBeDefined();
    expect(typeof res.body.data.drivers.total).toBe('number');
  });
});

// ── GET /api/admin/drivers ─────────────────────────────────────────────────────
describe('GET /api/admin/drivers', () => {
  test('200 — returns all drivers', async () => {
    const admin = await createUser({ email: 'admin2@test.com', role: 'admin' });
    await createDriver(hospital, { user: { email: 'drv_list@test.com' } });
    const agent = await loginAs(admin.email);

    const res = await agent.get('/api/admin/drivers');
    expect(res.status).toBe(200);
    expect(res.body.data.drivers.length).toBeGreaterThanOrEqual(1);
  });

  test('200 — ?verified=false filters unverified drivers', async () => {
    const admin = await createUser({ email: 'admin3@test.com', role: 'admin' });
    await createDriver(hospital, {
      user: { email: 'drv_unverified@test.com' },
      driver: { isVerified: false }
    });
    const agent = await loginAs(admin.email);

    const res = await agent.get('/api/admin/drivers?verified=false');
    expect(res.status).toBe(200);
    res.body.data.drivers.forEach((d) => {
      expect(d.isVerified).toBe(false);
    });
  });
});

// ── POST /api/admin/drivers/:id/verify ────────────────────────────────────────
describe('POST /api/admin/drivers/:id/verify', () => {
  test('200 — admin can verify an unverified driver', async () => {
    const admin = await createUser({ email: 'admin4@test.com', role: 'admin' });
    const { driver } = await createDriver(hospital, {
      user: { email: 'drv_to_verify@test.com' },
      driver: { isVerified: false }
    });
    const agent = await loginAs(admin.email);

    const res = await agent.post(`/api/admin/drivers/${driver._id}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.data.driver.isVerified).toBe(true);
    expect(res.body.data.driver.verifiedAt).toBeDefined();
  });

  test('409 — verifying an already-verified driver returns 409', async () => {
    const admin = await createUser({ email: 'admin5@test.com', role: 'admin' });
    const { driver } = await createDriver(hospital, {
      user: { email: 'drv_already_verified@test.com' },
      driver: { isVerified: true }
    });
    const agent = await loginAs(admin.email);

    const res = await agent.post(`/api/admin/drivers/${driver._id}/verify`);
    expect(res.status).toBe(409);
  });
});

// ── POST /api/admin/drivers/:id/revoke ────────────────────────────────────────
describe('POST /api/admin/drivers/:id/revoke', () => {
  test('200 — admin can revoke a verified driver', async () => {
    const admin = await createUser({ email: 'admin6@test.com', role: 'admin' });
    const { driver } = await createDriver(hospital, {
      user: { email: 'drv_to_revoke@test.com' },
      driver: { isVerified: true }
    });
    const agent = await loginAs(admin.email);

    const res = await agent.post(`/api/admin/drivers/${driver._id}/revoke`);
    expect(res.status).toBe(200);
    expect(res.body.data.driver.isVerified).toBe(false);
  });
});

// ── GET /api/admin/bookings/stale ─────────────────────────────────────────────
describe('GET /api/admin/bookings/stale', () => {
  test('200 — returns bookings older than threshold', async () => {
    const admin = await createUser({ email: 'admin7@test.com', role: 'admin' });
    const user = await createUser({ email: 'usr_stale@test.com' });

    // Create a booking and backdate its updatedAt to 60 minutes ago
    const booking = await createBooking(user);
    const sixtyMinsAgo = new Date(Date.now() - 61 * 60 * 1000);
    await booking.updateOne({ updatedAt: sixtyMinsAgo });

    const agent = await loginAs(admin.email);
    const res = await agent.get('/api/admin/bookings/stale?minutes=30');
    expect(res.status).toBe(200);
    expect(res.body.data.bookings.length).toBeGreaterThanOrEqual(1);
  });
});

// ── POST /api/admin/bookings/:id/force-cancel ─────────────────────────────────
describe('POST /api/admin/bookings/:id/force-cancel', () => {
  test('200 — admin can force-cancel a pending booking', async () => {
    const admin = await createUser({ email: 'admin8@test.com', role: 'admin' });
    const user = await createUser({ email: 'usr_forcecancel@test.com' });
    const booking = await createBooking(user);
    const agent = await loginAs(admin.email);

    const res = await agent.post(`/api/admin/bookings/${booking._id}/force-cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('cancelled');
    // Audit trail should contain admin_force_cancelled reason
    const history = res.body.data.booking.statusHistory;
    const forcedEntry = history.find((h) => h.reason === 'admin_force_cancelled');
    expect(forcedEntry).toBeDefined();
  });

  test('400 — cannot force-cancel an already completed booking', async () => {
    const admin = await createUser({ email: 'admin9@test.com', role: 'admin' });
    const user = await createUser({ email: 'usr_completed@test.com' });
    const booking = await createBooking(user, { status: 'completed' });
    const agent = await loginAs(admin.email);

    const res = await agent.post(`/api/admin/bookings/${booking._id}/force-cancel`);
    expect(res.status).toBe(400);
  });
});


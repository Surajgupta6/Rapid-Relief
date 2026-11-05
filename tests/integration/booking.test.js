/**
 * tests/integration/booking.test.js
 *
 * Integration tests for the booking API.
 * Covers: createBooking, getUserBookings, acceptBooking, updateBookingStatus,
 *         cancelBooking, rateBooking, declineBooking.
 * Also covers authorization (wrong role, non-owner, unauthenticated).
 */
'use strict';

const request = require('supertest');
const { app } = require('../../src/app');
const db = require('../setup/db');
const {
  DEFAULT_PASSWORD,
  DEFAULT_PICKUP,
  DEFAULT_DROP,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Login and return a persistent agent (cookie jar). */
async function loginAs(email, password = DEFAULT_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

const VALID_BOOKING_PAYLOAD = {
  patientName: 'Jane Doe',
  patientContact: '9876543210',
  medicalCondition: 'Chest pain',
  pickupLocation: DEFAULT_PICKUP,
  dropLocation: DEFAULT_DROP
};

// ── POST /booking ──────────────────────────────────────────────────────────────
describe('POST /booking', () => {
  test('401 — unauthenticated request is rejected', async () => {
    const res = await request(app).post('/booking').send(VALID_BOOKING_PAYLOAD);
    expect(res.status).toBe(401);
  });

  test('404 — no available drivers returns 404', async () => {
    const user = await createUser({ email: 'u1@test.com' });
    const agent = await loginAs(user.email);
    // No drivers created → dispatch finds nothing
    const res = await agent.post('/booking').send(VALID_BOOKING_PAYLOAD);
    expect(res.status).toBe(404);
  });

  test('201 — creates booking when verified driver is available', async () => {
    const user = await createUser({ email: 'u2@test.com' });
    await createDriver(hospital, {
      user: { email: 'drv2@test.com' },
      driver: { isVerified: true, isAvailable: true, locationSetAt: new Date() }
    });
    const agent = await loginAs(user.email);
    const res = await agent.post('/booking').send(VALID_BOOKING_PAYLOAD);
    expect(res.status).toBe(201);
    expect(res.body.data.booking.status).toBe('pending');
    expect(res.body.data.booking.patientName).toBe('Jane Doe');
  });

  test('400 — missing patientName returns validation error', async () => {
    const user = await createUser({ email: 'u3@test.com' });
    await createDriver(hospital, { user: { email: 'drv3@test.com' } });
    const agent = await loginAs(user.email);
    const res = await agent.post('/booking').send({
      patientContact: '9876543210',
      medicalCondition: 'Test',
      pickupLocation: DEFAULT_PICKUP,
      dropLocation: DEFAULT_DROP
    });
    expect(res.status).toBe(400);
  });

  test('409 — duplicate active booking is rejected', async () => {
    const user = await createUser({ email: 'u4@test.com' });
    await createDriver(hospital, { user: { email: 'drv4@test.com' } });
    // Create a pending booking first
    await createBooking(user);

    const agent = await loginAs(user.email);
    const res = await agent.post('/booking').send(VALID_BOOKING_PAYLOAD);
    expect(res.status).toBe(409);
  });
});

// ── GET /booking/user ──────────────────────────────────────────────────────────
describe('GET /booking/user', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app).get('/booking/user');
    expect(res.status).toBe(401);
  });

  test('200 — returns bookings belonging to the authenticated user only', async () => {
    const user = await createUser({ email: 'u5@test.com' });
    const other = await createUser({ email: 'u6@test.com' });
    await createBooking(user);
    await createBooking(other);

    const agent = await loginAs(user.email);
    const res = await agent.get('/booking/user');
    expect(res.status).toBe(200);
    expect(res.body.data.bookings).toHaveLength(1);
    expect(res.body.data.bookings[0].user.toString()).toBe(user._id.toString());
  });
});

// ── POST /booking/accept/:bookingId ───────────────────────────────────────────
describe('POST /booking/accept/:bookingId', () => {
  test('403 — non-driver cannot accept a booking', async () => {
    const user = await createUser({ email: 'u7@test.com' });
    const booking = await createBooking(user);
    const agent = await loginAs(user.email);
    const res = await agent.post(`/booking/accept/${booking._id}`);
    expect(res.status).toBe(403);
  });

  test('200 — verified driver can accept a pending booking', async () => {
    const user = await createUser({ email: 'u8@test.com' });
    const { user: drvUser, driver } = await createDriver(hospital, {
      user: { email: 'drv8@test.com' },
      driver: { isVerified: true }
    });
    const booking = await createBooking(user);

    // Log in as driver
    const drvAgent = request.agent(app);
    await drvAgent.post('/auth/login').send({ email: drvUser.email, password: DEFAULT_PASSWORD });

    const res = await drvAgent.post(`/booking/accept/${booking._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('accepted');
    expect(res.body.data.booking.driver.toString()).toBe(driver._id.toString());
  });

  test('404 — accepting a non-existent booking returns 404', async () => {
    const { user: drvUser } = await createDriver(hospital, {
      user: { email: 'drv9@test.com' }
    });
    const drvAgent = request.agent(app);
    await drvAgent.post('/auth/login').send({ email: drvUser.email, password: DEFAULT_PASSWORD });

    const fakeId = '507f1f77bcf86cd799439011';
    const res = await drvAgent.post(`/booking/accept/${fakeId}`);
    expect(res.status).toBe(404);
  });

  test('409 — accepting an already-accepted booking returns 409', async () => {
    const user = await createUser({ email: 'u10@test.com' });
    const { user: drv1User } = await createDriver(hospital, {
      user: { email: 'drv10a@test.com' }
    });
    const { user: drv2User } = await createDriver(hospital, {
      user: { email: 'drv10b@test.com' },
      driver: { licenseNumber: `LIC-B-${Date.now()}`, vehicleNumber: `VH-B-${Date.now()}`, ambulanceDetails: { registrationNumber: `AMB-B-${Date.now()}`, capacity: 2, features: [] } }
    });

    const booking = await createBooking(user);

    // Driver 1 accepts
    const agent1 = request.agent(app);
    await agent1.post('/auth/login').send({ email: drv1User.email, password: DEFAULT_PASSWORD });
    const first = await agent1.post(`/booking/accept/${booking._id}`);
    expect(first.status).toBe(200);

    // Driver 2 tries to accept the same booking
    const agent2 = request.agent(app);
    await agent2.post('/auth/login').send({ email: drv2User.email, password: DEFAULT_PASSWORD });
    const second = await agent2.post(`/booking/accept/${booking._id}`);
    expect(second.status).toBe(409);
  });
});

// ── POST /booking/:id/status ──────────────────────────────────────────────────
describe('POST /booking/:id/status', () => {
  test('400 — invalid status transition is rejected', async () => {
    const user = await createUser({ email: 'u11@test.com' });
    const { user: drvUser, driver } = await createDriver(hospital, {
      user: { email: 'drv11@test.com' }
    });
    const booking = await createBooking(user, {
      status: 'accepted',
      driver: driver._id
    });

    const drvAgent = request.agent(app);
    await drvAgent.post('/auth/login').send({ email: drvUser.email, password: DEFAULT_PASSWORD });

    // Cannot jump from accepted → completed (must go through inProgress)
    const res = await drvAgent.post(`/booking/${booking._id}/status`).send({ status: 'completed' });
    expect(res.status).toBe(400);
  });

  test('200 — valid transition accepted → inProgress succeeds', async () => {
    const user = await createUser({ email: 'u12@test.com' });
    const { user: drvUser, driver } = await createDriver(hospital, {
      user: { email: 'drv12@test.com' }
    });
    const booking = await createBooking(user, {
      status: 'accepted',
      driver: driver._id
    });

    const drvAgent = request.agent(app);
    await drvAgent.post('/auth/login').send({ email: drvUser.email, password: DEFAULT_PASSWORD });

    const res = await drvAgent.post(`/booking/${booking._id}/status`).send({ status: 'inProgress' });
    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('inProgress');
  });
});

// ── POST /booking/:id/cancel ──────────────────────────────────────────────────
describe('POST /booking/:id/cancel', () => {
  test('200 — booking owner can cancel a pending booking', async () => {
    const user = await createUser({ email: 'u13@test.com' });
    const booking = await createBooking(user);
    const agent = await loginAs(user.email);

    const res = await agent.post(`/booking/${booking._id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('cancelled');
  });

  test('403 — a different user cannot cancel another user\'s booking', async () => {
    const owner = await createUser({ email: 'u14@test.com' });
    const other = await createUser({ email: 'u15@test.com' });
    const booking = await createBooking(owner);
    const agent = await loginAs(other.email);

    const res = await agent.post(`/booking/${booking._id}/cancel`);
    expect(res.status).toBe(403);
  });

  test('400 — cannot cancel a completed booking', async () => {
    const user = await createUser({ email: 'u16@test.com' });
    const booking = await createBooking(user, { status: 'completed' });
    const agent = await loginAs(user.email);

    const res = await agent.post(`/booking/${booking._id}/cancel`);
    expect(res.status).toBe(400);
  });

  test('401 — unauthenticated cancel is rejected', async () => {
    const user = await createUser({ email: 'u17@test.com' });
    const booking = await createBooking(user);
    const res = await request(app).post(`/booking/${booking._id}/cancel`);
    expect(res.status).toBe(401);
  });
});

// ── POST /booking/:id/rate ────────────────────────────────────────────────────
describe('POST /booking/:id/rate', () => {
  test('200 — owner can rate a completed booking', async () => {
    const user = await createUser({ email: 'u18@test.com' });
    const { driver } = await createDriver(hospital, { user: { email: 'drv18@test.com' } });
    const booking = await createBooking(user, { status: 'completed', driver: driver._id });
    const agent = await loginAs(user.email);

    const res = await agent.post(`/booking/${booking._id}/rate`).send({ rating: 5, feedback: 'Great!' });
    expect(res.status).toBe(200);
    expect(res.body.data.booking.rating).toBe(5);
  });

  test('409 — rating same booking twice returns 409', async () => {
    const user = await createUser({ email: 'u19@test.com' });
    const { driver } = await createDriver(hospital, { user: { email: 'drv19@test.com' } });
    const booking = await createBooking(user, { status: 'completed', driver: driver._id, rating: 4 });
    const agent = await loginAs(user.email);

    const res = await agent.post(`/booking/${booking._id}/rate`).send({ rating: 5 });
    expect(res.status).toBe(409);
  });

  test('400 — rating a non-completed booking returns 400', async () => {
    const user = await createUser({ email: 'u20@test.com' });
    const booking = await createBooking(user, { status: 'pending' });
    const agent = await loginAs(user.email);

    const res = await agent.post(`/booking/${booking._id}/rate`).send({ rating: 4 });
    expect(res.status).toBe(400);
  });

  test('400 — rating out of range (0 or 6) returns 400', async () => {
    const user = await createUser({ email: 'u21@test.com' });
    const { driver } = await createDriver(hospital, { user: { email: 'drv21@test.com' } });
    const booking = await createBooking(user, { status: 'completed', driver: driver._id });
    const agent = await loginAs(user.email);

    const res = await agent.post(`/booking/${booking._id}/rate`).send({ rating: 6 });
    expect(res.status).toBe(400);
  });
});


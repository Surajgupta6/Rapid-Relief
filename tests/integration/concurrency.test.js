/**
 * tests/integration/concurrency.test.js
 *
 * Concurrency test: verifies that two simultaneous acceptBooking calls
 * on the same pending booking result in exactly one success (200) and
 * one conflict (409).
 *
 * This validates the optimistic-locking (__v) strategy from Phase 3.
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

describe('Concurrency: simultaneous acceptBooking', () => {
  test('exactly one driver wins when two accept the same booking at the same time', async () => {
    // Setup: one user creates a booking, two drivers try to accept it.
    const user = await createUser({ email: 'user_conc@test.com' });

    const { user: drv1User } = await createDriver(hospital, {
      user: { email: 'drv_conc1@test.com' }
    });
    const { user: drv2User } = await createDriver(hospital, {
      user: {
        email: 'drv_conc2@test.com',
        phone: '7000000002'
      },
      driver: {
        licenseNumber: `LIC-CONC2-${Date.now()}`,
        vehicleNumber: `VH-CONC2-${Date.now()}`,
        ambulanceDetails: {
          registrationNumber: `AMB-CONC2-${Date.now()}`,
          capacity: 2,
          features: []
        }
      }
    });

    const booking = await createBooking(user);

    // Log both drivers in concurrently
    const [agent1, agent2] = await Promise.all([
      (async () => {
        const a = request.agent(app);
        await a.post('/auth/login').send({ email: drv1User.email, password: DEFAULT_PASSWORD });
        return a;
      })(),
      (async () => {
        const a = request.agent(app);
        await a.post('/auth/login').send({ email: drv2User.email, password: DEFAULT_PASSWORD });
        return a;
      })()
    ]);

    // Fire both accept requests simultaneously
    const [res1, res2] = await Promise.all([
      agent1.post(`/booking/accept/${booking._id}`),
      agent2.post(`/booking/accept/${booking._id}`)
    ]);

    const statuses = [res1.status, res2.status].sort();

    // One must succeed (200), one must conflict (409)
    expect(statuses).toEqual([200, 409]);
  });
});


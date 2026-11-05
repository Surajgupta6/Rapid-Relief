/**
 * tests/integration/auth.test.js
 *
 * Integration tests for the authentication API.
 * Covers: register, login, logout, getCurrentUser.
 * Tests are run against an in-memory MongoDB instance (no real DB required).
 */
'use strict';

const request = require('supertest');
const { app } = require('../../src/app');
const db = require('../setup/db');
const { createUser, DEFAULT_PASSWORD } = require('../setup/helpers');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.disconnect(); });

// ── POST /auth/register ────────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  const validPayload = {
    name: 'Alice',
    email: 'alice@test.com',
    password: 'Password123!',
    phone: '9000000001',
    address: '1 Main St',
    role: 'user'
  };

  test('201 — registers a new user and returns session data', async () => {
    const res = await request(app).post('/auth/register').send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.email).toBe('alice@test.com');
    expect(res.body.data.user.password).toBeUndefined(); // never expose hash
  });

  test('400 — rejects duplicate email', async () => {
    await createUser({ email: 'alice@test.com' });
    const res = await request(app).post('/auth/register').send(validPayload);
    expect(res.status).toBe(400);
  });

  test('400 — rejects missing required fields', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'x@x.com' });
    expect(res.status).toBe(400);
  });

  test('400 — rejects password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validPayload, password: 'short' });
    expect(res.status).toBe(400);
  });

  test('400 — rejects invalid email format', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validPayload, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

// ── POST /auth/login ───────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  beforeEach(async () => {
    await createUser({ email: 'bob@test.com', password: DEFAULT_PASSWORD });
  });

  test('200 — logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'bob@test.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.headers['set-cookie']).toBeDefined(); // session cookie set
  });

  test('401 — wrong password returns generic message (no enumeration)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'bob@test.com', password: 'WrongPassword1!' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  test('401 — unknown email returns same generic message', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  test('400 — missing credentials returns validation error', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

// ── GET /auth/current-user ─────────────────────────────────────────────────────
describe('GET /auth/current-user', () => {
  test('401 — unauthenticated returns 401', async () => {
    const res = await request(app).get('/auth/current-user');
    expect(res.status).toBe(401);
  });

  test('200 — returns user data when authenticated', async () => {
    // Log in to establish a session cookie
    await createUser({ email: 'carol@test.com' });
    const agent = request.agent(app); // agent persists cookies
    await agent
      .post('/auth/login')
      .send({ email: 'carol@test.com', password: DEFAULT_PASSWORD });

    const res = await agent.get('/auth/current-user');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('carol@test.com');
  });
});

// ── GET /auth/logout ───────────────────────────────────────────────────────────
describe('GET /auth/logout', () => {
  test('200 — logs out and clears session', async () => {
    await createUser({ email: 'dan@test.com' });
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'dan@test.com', password: DEFAULT_PASSWORD });

    const logoutRes = await agent.get('/auth/logout');
    expect(logoutRes.status).toBe(200);

    // Session should be gone — current-user returns 401
    const meRes = await agent.get('/auth/current-user');
    expect(meRes.status).toBe(401);
  });
});


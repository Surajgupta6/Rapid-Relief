/**
 * tests/setup/env.js
 *
 * Sets environment variables required before any test module loads.
 * Jest runs this file via setupFiles (before the test framework initialises).
 *
 * Integration tests read MONGO_TEST_URI from the environment (or .env.test).
 * Unit tests don't need a MongoDB connection at all.
 *
 * To run integration tests locally:
 *   MONGO_TEST_URI=mongodb://localhost:27017/rapid-relief-test npm test
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-used-in-tests';
process.env.PORT = process.env.PORT || '0';
// MONGO_TEST_URI is optional — tests/setup/db.js handles fallbacks.

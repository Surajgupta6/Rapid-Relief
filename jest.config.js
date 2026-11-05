/**
 * jest.config.js
 *
 * Jest configuration for Rapid Relief.
 *
 * Key choices:
 *  - testEnvironment: 'node'       — no browser DOM needed
 *  - testTimeout: 30000            — in-memory MongoDB startup can be slow
 *  - forceExit: true               — prevents Jest hanging on open handles
 *                                    (session store, mongoose connections)
 *  - detectOpenHandles: true       — log remaining handles on slow teardown
 *  - collectCoverageFrom           — only measure coverage on application code
 *  - coverageThresholds            — enforce minimum 60% across all metrics;
 *                                    raise gradually as coverage improves
 */
'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: true,

  // Run each test file in its own worker to prevent shared Mongoose state
  maxWorkers: 1,

  collectCoverageFrom: [
    'src/**/*.js',
    '!src/start.js',           // entry point, not testable
    '!src/config/**',          // i18n / static config
    '!src/views/**',           // EJS templates
    '!src/public/**'           // static assets
  ],

  coverageThreshold: {
    global: {
      branches: 40,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },

  // Suppress verbose mongoose / server logs during tests
  silent: false,

  // Environment variables for the test run
  testEnvironmentOptions: {},

  // Global setup: set NODE_ENV=test before any test module loads
  globalSetup: undefined,
  setupFiles: ['<rootDir>/tests/setup/env.js']
};


/**
 * tests/setup/db.js
 *
 * Database setup for the test suite.
 *
 * Strategy:
 *  1. If MONGO_TEST_URI is set in the environment, connect directly to that
 *     instance (useful for CI pipelines with a sidecar MongoDB service).
 *  2. Otherwise, attempt to use MongoMemoryServer for a fully isolated,
 *     network-free in-memory database.  This requires the MMS binary to be
 *     already downloaded (run `npx mongodb-memory-server` once with network
 *     access, or set MONGOMS_DOWNLOAD_URL to a local mirror).
 *  3. If MMS fails to start (e.g., binary missing), fall back to
 *     mongodb://localhost:27017/rapid-relief-test and log a warning.
 *
 * Quick start for local development:
 *   Start MongoDB locally (mongod --dbpath /tmp/testdb) and run:
 *   MONGO_TEST_URI=mongodb://localhost:27017/rapid-relief-test npm test
 */
'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;
let usingExternalDb = false;

async function connect() {
  // Option 1: explicit URI override (CI / local with running MongoDB)
  if (process.env.MONGO_TEST_URI) {
    usingExternalDb = true;
    await mongoose.connect(process.env.MONGO_TEST_URI);
    return;
  }

  // Option 2: MongoMemoryServer (requires pre-downloaded binary)
  try {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    return;
  } catch (err) {
    if (err.message && err.message.includes('ENOTFOUND')) {
      console.warn(
        '\n[test-db] MongoMemoryServer could not download its binary (no network).' +
        '\nFalling back to mongodb://localhost:27017/rapid-relief-test.' +
        '\nMake sure mongod is running locally, or set MONGO_TEST_URI.\n'
      );
      mongod = null;
    } else {
      throw err;
    }
  }

  // Option 3: local fallback
  usingExternalDb = true;
  await mongoose.connect('mongodb://localhost:27017/rapid-relief-test');
}

async function clearDatabase() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

module.exports = { connect, clearDatabase, disconnect };

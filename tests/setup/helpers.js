/**
 * tests/setup/helpers.js
 *
 * Factory helpers for creating test fixtures (users, drivers, hospitals,
 * bookings) in an in-memory database.  Every helper returns the created
 * document AND the plain-object representation used to seed session data.
 */
'use strict';

const User = require('../../src/models/User');
const Driver = require('../../src/models/Driver');
const Hospital = require('../../src/models/Hospital');
const Booking = require('../../src/models/Booking');

// ── Default fixture data ───────────────────────────────────────────────────────

const DEFAULT_PASSWORD = 'Password123!';

const DEFAULT_USER = {
  name: 'Test User',
  email: 'user@test.com',
  password: DEFAULT_PASSWORD,
  phone: '9999999999',
  address: '1 Test Street',
  role: 'user'
};

const DEFAULT_DRIVER_USER = {
  name: 'Test Driver',
  email: 'driver@test.com',
  password: DEFAULT_PASSWORD,
  phone: '8888888888',
  address: '2 Driver Lane',
  role: 'driver'
};

const DEFAULT_PICKUP = {
  type: 'Point',
  coordinates: [77.209, 28.6139], // New Delhi
  address: 'India Gate'
};

const DEFAULT_DROP = {
  type: 'Point',
  coordinates: [77.2300, 28.6354],
  address: 'Red Fort'
};

// ── Factories ──────────────────────────────────────────────────────────────────

/**
 * Create a regular (non-driver) User document.
 * Password is hashed by the User pre-save hook.
 */
async function createUser(overrides = {}) {
  const data = { ...DEFAULT_USER, ...overrides };
  return User.create(data);
}

/**
 * Create a Hospital document (required for driver fixtures).
 */
async function createHospital(overrides = {}) {
  return Hospital.create({
    name: 'City General Hospital',
    address: '10 Hospital Road',
    contactNumber: '0112345678',
    email: `hospital-${Date.now()}@test.com`,
    password: 'HospitalPass123!',
    licenseNumber: `HOSP-LIC-${Date.now()}`,
    generalWard: { capacity: 100, availableBeds: 50 },
    opd: { capacity: 50, availableBeds: 20 },
    emergencyDepartment: { capacity: 20, availableBeds: 10 },
    location: { type: 'Point', coordinates: [77.209, 28.6139] },
    isVerified: true,
    ...overrides
  });
}

/**
 * Create a User + Driver pair ready for dispatch.
 * By default the driver is verified and available.
 */
async function createDriver(hospital, overrides = {}) {
  const userOverrides = overrides.user || {};
  const driverOverrides = overrides.driver || {};

  const user = await User.create({ ...DEFAULT_DRIVER_USER, ...userOverrides });

  const driver = await Driver.create({
    user: user._id,
    name: user.name,
    email: user.email,
    contactNumber: user.phone,
    licenseNumber: `LIC-${Date.now()}`,
    vehicleNumber: `VH-${Date.now()}`,
    vehicleType: 'Basic',
    hospital: hospital._id,
    isAvailable: true,
    isVerified: true,
    location: {
      type: 'Point',
      coordinates: [77.210, 28.614] // ~100 m from DEFAULT_PICKUP
    },
    locationSetAt: new Date(),
    ambulanceDetails: {
      registrationNumber: `AMB-${Date.now()}`,
      capacity: 2,
      features: []
    },
    status: 'available',
    ...driverOverrides
  });

  return { user, driver };
}

/**
 * Create a pending Booking document.
 */
async function createBooking(user, overrides = {}) {
  const booking = new Booking({
    user: user._id,
    type: 'regular',
    patientName: 'Test Patient',
    patientContact: '7777777777',
    medicalCondition: 'Test emergency',
    pickupLocation: DEFAULT_PICKUP,
    dropLocation: DEFAULT_DROP,
    status: 'pending',
    ...overrides
  });
  booking._changedBy = user._id;
  booking._changedByModel = 'User';
  booking._changeReason = 'booking_created';
  await booking.save();
  return booking;
}

/**
 * Build a mock Express session user object — equivalent to what
 * authController.login writes into req.session.user.
 */
function sessionFor(user, driverId = null) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    driverId: driverId ? driverId.toString() : null
  };
}

module.exports = {
  DEFAULT_PASSWORD,
  DEFAULT_PICKUP,
  DEFAULT_DROP,
  createUser,
  createHospital,
  createDriver,
  createBooking,
  sessionFor
};

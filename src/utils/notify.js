/**
 * notify.js — structured in-app notification helper.
 *
 * All Socket.IO event emissions go through this module so that:
 *  1. Event names and payload shapes are defined in one place.
 *  2. The same helper can be extended to push Firebase / APNs / SMS
 *     notifications later without touching every controller.
 *  3. Every emission is no-op-safe when io is not yet initialised.
 *
 * Usage:
 *   const notify = require('../utils/notify');
 *   notify.bookingCreated(req.app.io, { booking, nearbyDriverCount });
 */

'use strict';

// ── Internal helper ────────────────────────────────────────────────────────────
function emit(io, room, event, payload) {
  if (!io) return;
  const target = room ? io.to(room) : io;
  target.emit(event, { ...payload, _sentAt: Date.now() });
}

// ── Booking lifecycle ──────────────────────────────────────────────────────────

/** Broadcast a new regular booking to all drivers. */
exports.bookingCreated = (io, { booking, nearbyDriverCount, staleLocationWarning }) => {
  emit(io, 'drivers', 'newBookingAlert', {
    booking,
    nearbyDriverCount,
    staleLocationWarning
  });
};

/** Broadcast an anonymous emergency request to all drivers. */
exports.anonymousRequestCreated = (io, { booking, nearbyDriverCount, staleLocationWarning }) => {
  emit(io, 'drivers', 'anonymousRequestAlert', {
    booking,
    nearbyDriverCount,
    isAnonymous: true,
    staleLocationWarning
  });
};

/** Notify all parties that a booking has been accepted. */
exports.bookingAccepted = (io, { bookingId, driverId, driverName, hospitalId, vehicleInfo }) => {
  emit(io, null, 'bookingAccepted', {
    bookingId,
    driverId,
    driverName,
    hospitalId,
    vehicleInfo
  });
};

/** Notify all parties that a booking status changed (inProgress / completed). */
exports.bookingStatusUpdated = (io, { bookingId, status, driverId, driverName, hospitalName }) => {
  emit(io, null, 'bookingStatusUpdated', {
    bookingId,
    status,
    driverId,
    driverName,
    hospitalName
  });
};

/** Notify all parties that a booking was cancelled. */
exports.bookingCancelled = (io, { bookingId, reason }) => {
  emit(io, null, 'bookingCancelled', { bookingId, reason });
};

/** Re-broadcast a pending booking after a driver declines. */
exports.bookingStillPending = (io, { booking }) => {
  emit(io, 'drivers', 'bookingStillPending', {
    booking,
    message: 'A driver passed on this booking — it is still available'
  });
};

// ── Driver location ────────────────────────────────────────────────────────────

/**
 * Broadcast a driver location update to the booking room.
 * Only clients subscribed to booking_<bookingId> receive this.
 */
exports.driverLocationUpdate = (io, { bookingId, driverId, location, locationAge }) => {
  emit(io, `booking_${bookingId}`, 'driverLocationUpdate', {
    driverId,
    location,
    locationAge, // seconds since last DB-persisted update
    stale: locationAge > 30 * 60 // flag if >30 minutes since last persistence
  });
};

// ── Driver verification ────────────────────────────────────────────────────────

/** Notify a specific driver that their account was verified. */
exports.driverVerified = (io, { driverId }) => {
  emit(io, `driver_${driverId}`, 'driverVerified', {
    driverId,
    message: 'Your account has been verified. You can now receive bookings.'
  });
};

/** Notify a specific driver that their verification was revoked. */
exports.driverRevoked = (io, { driverId }) => {
  emit(io, `driver_${driverId}`, 'driverRevoked', {
    driverId,
    message: 'Your verification has been revoked. Please contact support.'
  });
};


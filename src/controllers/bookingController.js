const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const notify = require('../utils/notify');

// ─── Haversine fare calculation ───────────────────────────────────────────────
function calculateFare(pickupCoords, dropCoords) {
  const R = 6371;
  const dLat = ((dropCoords[1] - pickupCoords[1]) * Math.PI) / 180;
  const dLon = ((dropCoords[0] - pickupCoords[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((pickupCoords[1] * Math.PI) / 180) *
      Math.cos((dropCoords[1] * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(100 + distance * 15); // ₹100 base + ₹15/km
}

// ─── Dispatch helper ──────────────────────────────────────────────────────────
/**
 * Finds available, admin-verified drivers near a pickup point.
 *
 * Strategy (two-pass):
 *  1. $near search among verified drivers who have set their location
 *     (locationSetAt is not null), within a 50 km radius, sorted closest-first.
 *  2. If no geo-located drivers are found, fall back to any verified available
 *     driver regardless of location (emergency fallback).
 *
 * Returns { drivers, staleWarning } where staleWarning is true if one or more
 * drivers haven't updated their GPS in the last 30 minutes — the caller can
 * surface this to the user so they know ETA estimates may be inaccurate.
 */
async function findAvailableDrivers(pickupCoords) {
  // Pass 1 — proximity-aware, verified drivers only
  let drivers = await Driver.find({
    isAvailable: true,
    isVerified: true,
    locationSetAt: { $ne: null }, // exclude [0,0] default-coord drivers
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: pickupCoords },
        $maxDistance: 50000 // 50 km
      }
    }
  })
    .populate('user', 'name phone')
    .limit(20);

  // Pass 2 — fallback: any verified available driver regardless of location
  if (drivers.length === 0) {
    drivers = await Driver.find({
      isAvailable: true,
      isVerified: true
    }).populate('user', 'name phone');
  }

  // Stale-location warning: flag if any returned driver hasn't updated GPS
  // in the last 30 minutes.  ETAs may be unreliable for those drivers.
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const staleWarning = drivers.some(
    (d) => d.locationSetAt && d.locationSetAt < thirtyMinutesAgo
  );

  return { drivers, staleWarning };
}

// ─── Create a regular booking ─────────────────────────────────────────────────
exports.createBooking = async (req, res) => {
  try {
    const {
      patientName,
      patientContact,
      medicalCondition,
      pickupLocation,
      dropLocation
    } = req.body;

    // Guard: prevent duplicate active bookings from the same user
    const existingActive = await Booking.findOne({
      user: req.session.user.id,
      status: { $in: ['pending', 'accepted', 'inProgress'] }
    });
    if (existingActive) {
      return res.status(409).json({
        status: 'error',
        message: 'You already have an active booking. Cancel it before creating a new one.',
        data: { existingBookingId: existingActive._id }
      });
    }

    const pickupCoords = pickupLocation.coordinates;
    const { drivers: availableDrivers, staleWarning } = await findAvailableDrivers(pickupCoords);

    if (availableDrivers.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No ambulances are available in your area right now'
      });
    }

    // Calculate fare estimate up-front if drop coordinates are provided
    const dropCoords = dropLocation?.coordinates;
    const fare = dropCoords ? calculateFare(pickupCoords, dropCoords) : null;

    const booking = new Booking({
      user: req.session.user.id,
      type: 'regular',
      patientName,
      patientContact,
      medicalCondition,
      pickupLocation: {
        type: 'Point',
        coordinates: pickupCoords,
        address: pickupLocation.address
      },
      dropLocation: dropLocation
        ? {
            type: 'Point',
            coordinates: dropCoords,
            address: dropLocation.address
          }
        : {
            type: 'Point',
            coordinates: pickupCoords,
            address: 'To be determined'
          },
      fare,
      status: 'pending'
    });

    // Audit: who created this booking
    booking._changedBy = req.session.user.id;
    booking._changedByModel = 'User';
    booking._changeReason = 'booking_created';
    await booking.save();

    // Broadcast to all drivers connected to the 'drivers' Socket.IO room
    notify.bookingCreated(req.app.io, {
      booking,
      nearbyDriverCount: availableDrivers.length,
      staleLocationWarning: staleWarning
        ? 'Some nearby drivers have not updated their location recently — actual ETAs may vary'
        : undefined
    });

    res.status(201).json({
      status: 'success',
      message: 'Booking created successfully',
      data: {
        booking,
        nearbyDriverCount: availableDrivers.length,
        staleLocationWarning: staleWarning
          ? 'Some nearby drivers have not updated their location recently — actual ETAs may vary'
          : undefined
      }
    });
  } catch (err) {
    console.error('Booking creation error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create booking',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Get current user's bookings ──────────────────────────────────────────────
exports.getUserBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.session.user.id })
      .populate('driver', 'name vehicleNumber contactNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
    });
  } catch (err) {
    console.error('Error fetching user bookings:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch bookings',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Get bookings visible to the current driver ───────────────────────────────
// Returns:
//  - All bookings assigned to this driver
//  - All pending unassigned bookings (excluding those this driver declined)
exports.getDriverBookings = async (req, res) => {
  try {
    if (!req.session?.user || req.session.user.role !== 'driver' || !req.session.user.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver authentication required' });
    }

    const driverId = req.session.user.driverId;

    const bookings = await Booking.find({
      $or: [
        { driver: driverId },
        {
          status: 'pending',
          driver: { $exists: false },
          declinedBy: { $nin: [driverId] } // exclude bookings this driver already declined
        }
      ]
    })
      .populate({ path: 'user', select: 'name phone' })
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
    });
  } catch (err) {
    console.error('Error fetching driver bookings:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch bookings',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Driver accepts a booking ─────────────────────────────────────────────────
// Uses optimistic locking (__v) plus a MongoDB session/transaction where the
// deployment supports replica sets.  On standalone MongoDB (local dev without
// a replica set) the transaction is skipped and the two-write sequence runs
// without a transaction — the optimistic lock still prevents double-accept.
exports.acceptBooking = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;

    if (!req.session.user || !req.session.user.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver session not found' });
    }

    const driverId = req.session.user.driverId;

    const driver = await Driver.findById(driverId).populate('hospital');
    if (!driver) {
      return res.status(404).json({ status: 'error', message: 'Driver not found' });
    }

    // Guard: driver must not already be handling another booking
    if (driver.currentBooking) {
      return res.status(409).json({
        status: 'error',
        message: 'You already have an active booking. Complete or cancel it before accepting a new one.'
      });
    }

    // ── Optimistic-lock read ───────────────────────────────────────────────────
    // Read the booking's current version before the update.
    const bookingToAccept = await Booking.findOne({ _id: bookingId, status: 'pending' });
    if (!bookingToAccept) {
      const exists = await Booking.exists({ _id: bookingId });
      if (!exists) {
        return res.status(404).json({ status: 'error', message: 'Booking not found' });
      }
      return res.status(409).json({
        status: 'error',
        message: 'This booking was already accepted by another driver'
      });
    }
    const currentVersion = bookingToAccept.__v;

    // ── Transaction attempt ───────────────────────────────────────────────────
    // Try to open a MongoDB client session for a multi-document transaction.
    // If the deployment is a standalone node (no replica set), startSession()
    // still succeeds but commitTransaction() will throw — we catch that and
    // fall through to the non-transactional path.
    let booking = null;
    let usedTransaction = false;

    const mongoSession = await mongoose.startSession();
    try {
      mongoSession.startTransaction();

      // Atomic claim with optimistic locking — only succeeds if __v matches.
      booking = await Booking.findOneAndUpdate(
        { _id: bookingId, status: 'pending', __v: currentVersion },
        {
          $set: {
            status: 'accepted',
            driver: driverId,
            hospital: driver.hospital?._id,
            acceptedAt: new Date()
          },
          $push: {
            statusHistory: {
              status: 'accepted',
              changedBy: driverId,
              changedByModel: 'Driver',
              reason: 'driver_accepted',
              timestamp: new Date()
            }
          },
          $inc: { __v: 1 }
        },
        { new: true, session: mongoSession }
      );

      if (!booking) {
        await mongoSession.abortTransaction();
        const exists = await Booking.exists({ _id: bookingId });
        if (!exists) {
          return res.status(404).json({ status: 'error', message: 'Booking not found' });
        }
        return res.status(409).json({
          status: 'error',
          message: 'This booking was already accepted by another driver'
        });
      }

      await Driver.findByIdAndUpdate(
        driverId,
        { isAvailable: false, currentBooking: booking._id },
        { session: mongoSession }
      );

      await mongoSession.commitTransaction();
      usedTransaction = true;
    } catch (txErr) {
      // Standalone MongoDB does not support multi-document transactions.
      // Fall back to two sequential writes — optimistic lock still guards
      // against the race condition.
      await mongoSession.abortTransaction().catch(() => {});

      if (usedTransaction) {
        // The transaction itself committed but something else failed — rethrow.
        throw txErr;
      }

      // Non-transactional fallback
      booking = await Booking.findOneAndUpdate(
        { _id: bookingId, status: 'pending', __v: currentVersion },
        {
          $set: {
            status: 'accepted',
            driver: driverId,
            hospital: driver.hospital?._id,
            acceptedAt: new Date()
          },
          $push: {
            statusHistory: {
              status: 'accepted',
              changedBy: driverId,
              changedByModel: 'Driver',
              reason: 'driver_accepted',
              timestamp: new Date()
            }
          },
          $inc: { __v: 1 }
        },
        { new: true }
      );

      if (!booking) {
        return res.status(409).json({
          status: 'error',
          message: 'This booking was already accepted by another driver'
        });
      }

      await Driver.findByIdAndUpdate(driverId, {
        isAvailable: false,
        currentBooking: booking._id
      });
    } finally {
      mongoSession.endSession();
    }

    notify.bookingAccepted(req.app.io, {
      bookingId: booking._id,
      driverId,
      driverName: driver.name,
      hospitalId: driver.hospital?._id,
      vehicleInfo: driver.ambulanceDetails
        ? `${driver.ambulanceDetails.registrationNumber} — ${driver.vehicleType}`
        : ''
    });

    res.status(200).json({
      status: 'success',
      message: 'Booking accepted',
      data: { booking }
    });
  } catch (error) {
    console.error('Error accepting booking:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to accept booking',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── Driver updates booking status ────────────────────────────────────────────
// Valid transitions: accepted → inProgress → completed
exports.updateBookingStatus = async (req, res) => {
  try {
    if (req.session?.user?.role !== 'driver' || !req.session?.user?.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver authentication required' });
    }

    const { status } = req.body;
    const allowedStatuses = ['inProgress', 'completed'];

    if (!status) {
      return res.status(400).json({ status: 'error', message: 'Status is required' });
    }
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`
      });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    // Ownership check
    if (booking.driver?.toString() !== req.session.user.driverId.toString()) {
      return res.status(403).json({ status: 'error', message: 'This booking is not assigned to you' });
    }

    // State machine — only allowed transitions
    const validTransitions = {
      accepted: ['inProgress'],
      inProgress: ['completed']
    };

    if (!validTransitions[booking.status]?.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot transition from '${booking.status}' to '${status}'. Allowed next states: ${validTransitions[booking.status]?.join(', ') || 'none'}`
      });
    }

    booking.status = status;
    if (status === 'inProgress') booking.startedAt = new Date();
    if (status === 'completed') booking.completedAt = new Date();

    // Audit trail — set transient fields for the pre-save hook
    booking._changedBy = req.session.user.driverId;
    booking._changedByModel = 'Driver';
    booking._changeReason = status === 'inProgress' ? 'trip_started' : 'trip_completed';
    await booking.save();

    // Free the driver on completion
    if (status === 'completed') {
      await Driver.findByIdAndUpdate(req.session.user.driverId, {
        isAvailable: true,
        currentBooking: null
      });
    }

    const driver = await Driver.findById(req.session.user.driverId)
      .populate('user', 'name')
      .populate('hospital', 'name');

    notify.bookingStatusUpdated(req.app.io, {
      bookingId: booking._id,
      status,
      driverId: req.session.user.driverId,
      driverName: driver?.user?.name,
      hospitalName: driver?.hospital?.name
    });

    res.status(200).json({
      status: 'success',
      message: `Booking updated to '${status}'`,
      data: { booking }
    });
  } catch (err) {
    console.error('Error updating booking status:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update booking status',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Cancel booking ───────────────────────────────────────────────────────────
exports.cancelBooking = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ status: 'error', message: 'You are not logged in' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    const isOwner = booking.user?.toString() === req.session.user.id;
    const isAssignedDriver =
      req.session.user.role === 'driver' &&
      booking.driver?.toString() === req.session.user.driverId?.toString();

    if (!isOwner && !isAssignedDriver) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not authorised to cancel this booking'
      });
    }

    if (!['pending', 'accepted'].includes(booking.status)) {
      return res.status(400).json({
        status: 'error',
        message: `A booking with status '${booking.status}' cannot be cancelled`
      });
    }

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();

    // Audit trail
    const isDriver = req.session.user.role === 'driver';
    booking._changedBy = isDriver ? req.session.user.driverId : req.session.user.id;
    booking._changedByModel = isDriver ? 'Driver' : 'User';
    booking._changeReason = isDriver ? 'driver_cancelled' : 'user_cancelled';
    await booking.save();

    // Free the driver if one was assigned
    if (booking.driver) {
      await Driver.findByIdAndUpdate(booking.driver, {
        isAvailable: true,
        currentBooking: null
      });
    }

    notify.bookingCancelled(req.app.io, { bookingId: booking._id });

    res.status(200).json({ status: 'success', data: { booking } });
  } catch (err) {
    console.error('Error cancelling booking:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to cancel booking',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Rate a completed booking ─────────────────────────────────────────────────
exports.rateBooking = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ status: 'error', message: 'You are not logged in' });
    }

    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ status: 'error', message: 'Rating must be between 1 and 5' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    if (booking.user?.toString() !== req.session.user.id) {
      return res.status(403).json({ status: 'error', message: 'You can only rate your own bookings' });
    }

    if (booking.status !== 'completed') {
      return res.status(400).json({ status: 'error', message: 'Only completed bookings can be rated' });
    }

    if (booking.rating) {
      return res.status(409).json({ status: 'error', message: 'This booking has already been rated' });
    }

    booking.rating = rating;
    booking.feedback = feedback?.trim() || '';
    await booking.save();

    // Update driver's rolling average
    if (booking.driver) {
      const driver = await Driver.findById(booking.driver);
      if (driver) {
        const newTotal = driver.totalRatings + 1;
        driver.rating = (driver.rating * driver.totalRatings + rating) / newTotal;
        driver.totalRatings = newTotal;
        await driver.save();
      }
    }

    res.status(200).json({ status: 'success', data: { booking } });
  } catch (err) {
    console.error('Error rating booking:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to rate booking',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Driver declines a booking ────────────────────────────────────────────────
// Status stays 'pending'; driver is added to declinedBy so they won't be
// offered the same booking again.  A re-broadcast alert is emitted so other
// available drivers are notified that the booking is still open.
exports.declineBooking = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;

    if (!req.session.user || !req.session.user.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver session not found' });
    }

    const driverId = req.session.user.driverId;
    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: 'Only pending bookings can be declined'
      });
    }

    // Idempotent: don't push duplicate declines
    const alreadyDeclined = booking.declinedBy.some(
      (id) => id.toString() === driverId.toString()
    );
    if (!alreadyDeclined) {
      booking.declinedBy.push(driverId);
    }
    await booking.save();

    notify.bookingStillPending(req.app.io, { booking });

    res.status(200).json({
      status: 'success',
      message: 'Booking declined',
      data: { booking }
    });
  } catch (error) {
    console.error('Error declining booking:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to decline booking',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── Driver's current active booking ─────────────────────────────────────────
exports.getDriverCurrentBooking = async (req, res) => {
  try {
    if (req.session?.user?.role !== 'driver' || !req.session?.user?.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver authentication required' });
    }

    const currentBooking = await Booking.findOne({
      driver: req.session.user.driverId,
      status: { $in: ['accepted', 'inProgress'] }
    })
      .sort({ createdAt: -1 })
      .populate('user', 'name phone')
      .lean();

    return res.status(200).json({
      status: 'success',
      data: { booking: currentBooking || null }
    });
  } catch (error) {
    console.error('Error fetching current booking:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch current booking',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── Anonymous emergency request ──────────────────────────────────────────────
// Idempotency key: clients may send an `idempotencyKey` (e.g. a UUID
// generated on the device) with each request.  If a booking with that key was
// already created in the last 5 minutes, the existing booking is returned
// rather than creating a duplicate — safe to retry on network failure.
exports.createAnonymousRequest = async (req, res) => {
  try {
    const { coordinates, timestamp, idempotencyKey } = req.body;

    // Input validation is handled by the route middleware; this is a safety net
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ status: 'error', message: 'Invalid coordinates' });
    }

    // ── Idempotency check ──────────────────────────────────────────────────────
    if (idempotencyKey) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const existingBooking = await Booking.findOne({
        idempotencyKey,
        createdAt: { $gte: fiveMinutesAgo }
      });
      if (existingBooking) {
        return res.status(200).json({
          status: 'success',
          message: 'Duplicate request — returning existing booking',
          data: { booking: existingBooking, deduplicated: true }
        });
      }
    }

    const { drivers: availableDrivers, staleWarning } = await findAvailableDrivers(coordinates);

    if (availableDrivers.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No ambulances are available right now. Please call 112 directly.'
      });
    }

    const booking = new Booking({
      type: 'anonymous',
      // isAnonymous is set automatically by the Booking pre-save hook
      idempotencyKey: idempotencyKey || null,
      pickupLocation: {
        type: 'Point',
        coordinates,
        address: 'Emergency Location'
      },
      dropLocation: {
        type: 'Point',
        coordinates,
        address: 'To be determined'
      },
      status: 'pending'
    });

    // Audit: system-initiated (no changedBy for anonymous)
    booking._changeReason = 'anonymous_request_created';
    await booking.save();

    notify.anonymousRequestCreated(req.app.io, {
      booking,
      nearbyDriverCount: availableDrivers.length,
      staleLocationWarning: staleWarning
        ? 'Some nearby drivers have not updated their location recently — actual ETAs may vary'
        : undefined
    });

    res.status(200).json({
      status: 'success',
      message: 'Emergency request sent to all available drivers',
      data: {
        booking,
        nearbyDriverCount: availableDrivers.length,
        staleLocationWarning: staleWarning
          ? 'Some nearby drivers have not updated their location recently — actual ETAs may vary'
          : undefined
      }
    });
  } catch (err) {
    console.error('Anonymous request error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process emergency request',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

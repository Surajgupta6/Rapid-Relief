const Driver = require('../models/Driver');
const User = require('../models/User');
const Booking = require('../models/Booking');
const notify = require('../utils/notify');

// ─── List all drivers (with verification status) ──────────────────────────────
exports.listDrivers = async (req, res) => {
  try {
    const { verified } = req.query; // ?verified=true|false|all

    const filter = {};
    if (verified === 'true') filter.isVerified = true;
    else if (verified === 'false') filter.isVerified = false;
    // default: return all

    const drivers = await Driver.find(filter)
      .populate('user', 'name email phone createdAt')
      .populate('hospital', 'name address')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      results: drivers.length,
      data: { drivers }
    });
  } catch (err) {
    console.error('Admin listDrivers error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch drivers',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Verify (approve) a driver ────────────────────────────────────────────────
// POST /api/admin/drivers/:driverId/verify
exports.verifyDriver = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ status: 'error', message: 'Driver not found' });
    }

    if (driver.isVerified) {
      return res.status(409).json({ status: 'error', message: 'Driver is already verified' });
    }

    driver.isVerified = true;
    driver.verifiedAt = new Date();
    driver.verifiedBy = req.session.user.id;
    await driver.save();

    // Notify the driver via their personal room (driver_<id>)
    notify.driverVerified(req.app.io, { driverId: driver._id });

    res.status(200).json({
      status: 'success',
      message: `Driver ${driver.name} has been verified`,
      data: { driver }
    });
  } catch (err) {
    console.error('Admin verifyDriver error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to verify driver',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Revoke a driver's verification ──────────────────────────────────────────
// POST /api/admin/drivers/:driverId/revoke
exports.revokeDriver = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ status: 'error', message: 'Driver not found' });
    }

    if (!driver.isVerified) {
      return res.status(409).json({ status: 'error', message: 'Driver is not currently verified' });
    }

    driver.isVerified = false;
    driver.verifiedAt = null;
    driver.verifiedBy = null;
    // Force the driver offline so they cannot receive new bookings
    driver.isAvailable = false;
    await driver.save();

    notify.driverRevoked(req.app.io, { driverId: driver._id });

    res.status(200).json({
      status: 'success',
      message: `Driver ${driver.name}'s verification has been revoked`,
      data: { driver }
    });
  } catch (err) {
    console.error('Admin revokeDriver error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to revoke driver',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── List stale pending bookings ──────────────────────────────────────────────
// GET /api/admin/bookings/stale?minutes=30
// Returns bookings that have been in 'pending' status for longer than the
// specified threshold (default 30 minutes).  Useful for manual review and
// force-cancellation of orphaned requests.
exports.listStaleBookings = async (req, res) => {
  try {
    const minutes = Math.max(1, parseInt(req.query.minutes) || 30);
    const threshold = new Date(Date.now() - minutes * 60 * 1000);

    const staleBookings = await Booking.find({
      status: 'pending',
      updatedAt: { $lte: threshold }
    })
      .populate('user', 'name phone email')
      .sort({ updatedAt: 1 }); // oldest first

    res.status(200).json({
      status: 'success',
      results: staleBookings.length,
      thresholdMinutes: minutes,
      data: { bookings: staleBookings }
    });
  } catch (err) {
    console.error('Admin listStaleBookings error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch stale bookings',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Force-cancel a stale booking ────────────────────────────────────────────
// POST /api/admin/bookings/:bookingId/force-cancel
// Allows an admin to cancel any pending booking that has not been accepted.
// The action is recorded in statusHistory with the admin's identity.
exports.forceCancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    if (!['pending', 'accepted'].includes(booking.status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot force-cancel a booking with status '${booking.status}'`
      });
    }

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();

    // Audit trail — admin identity
    booking._changedBy = req.session.user.id;
    booking._changedByModel = 'User';
    booking._changeReason = 'admin_force_cancelled';
    await booking.save();

    // Free the driver if one was assigned
    if (booking.driver) {
      await Driver.findByIdAndUpdate(booking.driver, {
        isAvailable: true,
        currentBooking: null
      });
    }

    notify.bookingCancelled(req.app.io, {
      bookingId: booking._id,
      reason: 'Admin force-cancelled (no driver accepted in time)'
    });

    res.status(200).json({
      status: 'success',
      message: `Booking ${bookingId} has been force-cancelled`,
      data: { booking }
    });
  } catch (err) {
    console.error('Admin forceCancelBooking error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to force-cancel booking',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── List stale drivers ───────────────────────────────────────────────────────
// GET /api/admin/drivers/stale?minutes=30
// Returns drivers whose last GPS update is older than the threshold.
exports.listStaleDrivers = async (req, res) => {
  try {
    const minutes = Math.max(1, parseInt(req.query.minutes) || 30);
    const threshold = new Date(Date.now() - minutes * 60 * 1000);

    const staleDrivers = await Driver.find({
      isAvailable: true,
      isVerified: true,
      locationSetAt: { $ne: null, $lte: threshold }
    })
      .populate('user', 'name phone email')
      .populate('hospital', 'name')
      .sort({ locationSetAt: 1 }); // stalest first

    res.status(200).json({
      status: 'success',
      results: staleDrivers.length,
      thresholdMinutes: minutes,
      data: { drivers: staleDrivers }
    });
  } catch (err) {
    console.error('Admin listStaleDrivers error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch stale drivers',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Platform statistics ──────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const [
      totalUsers,
      totalDrivers,
      pendingVerification,
      totalBookings,
      activeBookings,
      completedBookings,
      staleBookings,
      staleDrivers
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      Driver.countDocuments(),
      Driver.countDocuments({ isVerified: false }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: { $in: ['pending', 'accepted', 'inProgress'] } }),
      Booking.countDocuments({ status: 'completed' }),
      Booking.countDocuments({ status: 'pending', updatedAt: { $lte: thirtyMinutesAgo } }),
      Driver.countDocuments({
        isAvailable: true,
        isVerified: true,
        locationSetAt: { $ne: null, $lte: thirtyMinutesAgo }
      })
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        users: { total: totalUsers },
        drivers: {
          total: totalDrivers,
          pendingVerification,
          verified: totalDrivers - pendingVerification,
          staleLocation: staleDrivers
        },
        bookings: {
          total: totalBookings,
          active: activeBookings,
          completed: completedBookings,
          stalePending: staleBookings
        }
      }
    });
  } catch (err) {
    console.error('Admin getStats error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch statistics',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

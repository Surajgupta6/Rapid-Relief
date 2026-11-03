const Driver = require('../models/Driver');
const User = require('../models/User');
const Booking = require('../models/Booking');

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

    // Emit a socket event so the driver's dashboard updates in real time
    if (req.app.io) {
      req.app.io.emit('driverVerified', {
        driverId: driver._id,
        message: 'Your account has been verified. You can now receive bookings.'
      });
    }

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

    if (req.app.io) {
      req.app.io.emit('driverRevoked', {
        driverId: driver._id,
        message: 'Your verification has been revoked. Please contact support.'
      });
    }

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

// ─── Platform statistics ──────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalDrivers,
      pendingVerification,
      totalBookings,
      activeBookings,
      completedBookings
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      Driver.countDocuments(),
      Driver.countDocuments({ isVerified: false }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: { $in: ['pending', 'accepted', 'inProgress'] } }),
      Booking.countDocuments({ status: 'completed' })
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        users: { total: totalUsers },
        drivers: {
          total: totalDrivers,
          pendingVerification,
          verified: totalDrivers - pendingVerification
        },
        bookings: {
          total: totalBookings,
          active: activeBookings,
          completed: completedBookings
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

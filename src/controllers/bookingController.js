const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const User = require('../models/User');

// ─── Create a new booking ─────────────────────────────────────────────────────
exports.createBooking = async (req, res) => {
  try {
    const { patientName, patientContact, medicalCondition, pickupLocation, dropLocation } = req.body;

    if (!patientName || !patientContact || !medicalCondition || !pickupLocation) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide all required fields'
      });
    }

    // Find all available drivers
    const availableDrivers = await Driver.find({
      isAvailable: true,
      isOnDuty: true
    }).populate('user', 'name phone');

    if (availableDrivers.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No available ambulances found'
      });
    }

    // Create the booking with proper GeoJSON format
    const booking = await Booking.create({
      user: req.session.user.id,
      type: 'regular',
      patientName,
      patientContact,
      medicalCondition,
      pickupLocation: {
        type: 'Point',
        coordinates: pickupLocation.coordinates,
        address: pickupLocation.address
      },
      dropLocation: dropLocation
        ? {
            type: 'Point',
            coordinates: dropLocation.coordinates,
            address: dropLocation.address
          }
        : {
            type: 'Point',
            coordinates: pickupLocation.coordinates,
            address: 'To be determined'
          },
      status: 'pending'
    });

    // Notify all drivers in the 'drivers' room
    if (req.app.io) {
      req.app.io.to('drivers').emit('newBookingAlert', {
        booking,
        totalDrivers: availableDrivers.length
      });
    }

    res.status(201).json({
      status: 'success',
      message: 'Booking created successfully',
      data: {
        booking,
        totalDrivers: availableDrivers.length
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

// ─── Haversine fare calculation ───────────────────────────────────────────────
function calculateFare(pickupCoords, dropCoords) {
  const R = 6371; // Earth radius in km
  const dLat = ((dropCoords[1] - pickupCoords[1]) * Math.PI) / 180;
  const dLon = ((dropCoords[0] - pickupCoords[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pickupCoords[1] * Math.PI) / 180) *
      Math.cos((dropCoords[1] * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // km
  const baseFare = 100;
  const ratePerKm = 15;
  return Math.round(baseFare + distance * ratePerKm);
}

// ─── Get all bookings for the current user ────────────────────────────────────
exports.getUserBookings = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ status: 'error', message: 'You are not logged in' });
    }

    const bookings = await Booking.find({ user: req.session.user.id })
      .populate('driver', 'name vehicleNumber')
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

// ─── Get all bookings visible to the current driver ───────────────────────────
exports.getDriverBookings = async (req, res) => {
  try {
    if (!req.session?.user || req.session.user.role !== 'driver' || !req.session.user.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver authentication required' });
    }

    const bookings = await Booking.find({
      $or: [
        { driver: req.session.user.driverId },
        {
          status: 'pending',
          driver: { $exists: false }
        }
      ]
    })
      .populate({ path: 'user', select: 'name phone' })
      .populate('pickupLocation')
      .populate('dropLocation')
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

// ─── Driver accepts a booking (atomic) ───────────────────────────────────────
// Uses findOneAndUpdate with a status filter so that only one driver can claim
// a pending booking even if multiple drivers call this endpoint simultaneously.
exports.acceptBooking = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;

    if (!req.session.user || !req.session.user.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver not found in session' });
    }

    const driverId = req.session.user.driverId;

    const driver = await Driver.findById(driverId).populate('hospital');
    if (!driver) {
      return res.status(404).json({ status: 'error', message: 'Driver not found' });
    }

    // ── Atomic claim ──────────────────────────────────────────────────────────
    // A single MongoDB findOneAndUpdate with { status: 'pending' } in the
    // filter is atomic at the document level.  If two drivers race, exactly
    // one will match and the other will receive null → 409 Conflict.
    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, status: 'pending' },
      {
        status: 'accepted',
        driver: driverId,
        hospital: driver.hospital._id,
        acceptedAt: new Date()
      },
      { new: true }
    );

    if (!booking) {
      const exists = await Booking.exists({ _id: bookingId });
      if (!exists) {
        return res.status(404).json({ status: 'error', message: 'Booking not found' });
      }
      return res.status(409).json({
        status: 'error',
        message: 'This booking has already been accepted by another driver'
      });
    }

    // Mark driver as busy
    await Driver.findByIdAndUpdate(driverId, {
      isAvailable: false,
      currentBooking: bookingId
    });

    // Broadcast to all clients (patient's tab will listen for their booking id)
    if (req.app.io) {
      req.app.io.emit('bookingAccepted', {
        bookingId: booking._id,
        driverId,
        driverName: driver.name,
        hospitalId: driver.hospital._id,
        vehicleInfo: `${driver.ambulanceDetails?.model || ''} (${driver.ambulanceDetails?.registrationNumber || ''})`
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking accepted successfully',
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

// ─── Driver updates booking status (inProgress / completed) ──────────────────
exports.updateBookingStatus = async (req, res) => {
  try {
    // FIX (DEF-002): was `!req.session?.user?.role === 'driver'` which always
    // evaluates to false due to operator precedence, bypassing the auth check.
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
        message: `Invalid status. Allowed values are: ${allowedStatuses.join(', ')}`
      });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    // Ownership check — only the assigned driver may update
    if (booking.driver?.toString() !== req.session.user.driverId.toString()) {
      return res.status(403).json({ status: 'error', message: 'This booking is not assigned to you' });
    }

    // State-machine transition validation
    const validTransitions = {
      accepted: ['inProgress'],
      inProgress: ['completed']
    };

    if (!validTransitions[booking.status]?.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot change status from '${booking.status}' to '${status}'. Valid transitions: ${validTransitions[booking.status]?.join(', ') || 'none'}`
      });
    }

    booking.status = status;
    if (status === 'inProgress') booking.startedAt = new Date();
    if (status === 'completed') booking.completedAt = new Date();
    await booking.save();

    // Restore driver availability on completion
    if (status === 'completed') {
      await Driver.findByIdAndUpdate(req.session.user.driverId, {
        isAvailable: true,
        currentBooking: null
      });
    } else if (status === 'inProgress') {
      await Driver.findByIdAndUpdate(req.session.user.driverId, {
        isAvailable: false,
        currentBooking: booking._id
      });
    }

    const driver = await Driver.findById(req.session.user.driverId)
      .populate('user', 'name')
      .populate('hospital', 'name');

    if (req.app.io) {
      req.app.io.emit('bookingStatusUpdated', {
        bookingId: booking._id,
        status,
        driverId: req.session.user.driverId,
        driverName: driver?.user?.name,
        hospitalName: driver?.hospital?.name,
        timestamp: Date.now(),
        isTripInProgress: status === 'inProgress'
      });
    }

    res.status(200).json({
      status: 'success',
      message: `Booking status updated to ${status} successfully`,
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

    // Authorisation: the patient who made the booking OR the assigned driver
    const isOwner = booking.user?.toString() === req.session.user.id;
    const isAssignedDriver =
      req.session.user.role === 'driver' &&
      booking.driver?.toString() === req.session.user.driverId?.toString();

    if (!isOwner && !isAssignedDriver) {
      return res.status(403).json({ status: 'error', message: 'You are not authorised to cancel this booking' });
    }

    if (!['pending', 'accepted'].includes(booking.status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot cancel a booking that is already '${booking.status}'`
      });
    }

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    await booking.save();

    // Free the driver if one was assigned
    if (booking.driver) {
      await Driver.findByIdAndUpdate(booking.driver, {
        isAvailable: true,
        currentBooking: null
      });
    }

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
      return res.status(400).json({ status: 'error', message: 'You can only rate completed bookings' });
    }

    booking.rating = rating;
    booking.feedback = feedback || '';
    await booking.save();

    // Update driver's rolling average rating
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
// NOTE (DB-003): The status is intentionally left as 'pending' after a decline
// so that other drivers can still claim the booking.  The declining driver's ID
// is pushed onto `declinedBy` so they won't be sent the request again (future
// filter logic — tracked as Phase 2 work).
exports.declineBooking = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;

    if (!req.session.user || !req.session.user.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver not found in session' });
    }

    const driverId = req.session.user.driverId;
    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: 'This booking cannot be declined as it is no longer pending'
      });
    }

    // Keep status as 'pending' — only record who declined
    booking.declinedBy = booking.declinedBy || [];
    booking.declinedBy.push(driverId);
    await booking.save();

    if (req.app.io) {
      req.app.io.emit('bookingDeclined', { bookingId: booking._id, driverId });
    }

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

// ─── Get the driver's current active booking ──────────────────────────────────
exports.getDriverCurrentBooking = async (req, res) => {
  try {
    // FIX (DEF-002): was `!req.session?.user?.role === 'driver'` — operator
    // precedence bug that always evaluated to false.
    if (req.session?.user?.role !== 'driver' || !req.session?.user?.driverId) {
      return res.status(401).json({ status: 'error', message: 'Driver authentication required' });
    }

    const driverId = req.session.user.driverId;

    const currentBooking = await Booking.findOne({
      driver: driverId,
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

// ─── Handle anonymous ambulance request ───────────────────────────────────────
exports.createAnonymousRequest = async (req, res) => {
  try {
    const { coordinates, timestamp } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ status: 'error', message: 'Invalid coordinates provided' });
    }

    // Basic coordinate range validation
    const [lng, lat] = coordinates;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return res.status(400).json({ status: 'error', message: 'Coordinates out of valid range' });
    }

    const availableDrivers = await Driver.find({
      isAvailable: true,
      isOnDuty: true
    }).populate('user', 'name phone');

    if (availableDrivers.length === 0) {
      return res.status(404).json({ status: 'error', message: 'No available ambulances found' });
    }

    const booking = await Booking.create({
      type: 'anonymous',
      isAnonymous: true,
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
      status: 'pending',
      createdAt: timestamp || Date.now()
    });

    if (req.app.io) {
      req.app.io.to('drivers').emit('anonymousRequestAlert', {
        booking,
        totalDrivers: availableDrivers.length,
        isAnonymous: true
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Emergency request sent to all available drivers',
      data: { booking, totalDrivers: availableDrivers.length }
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

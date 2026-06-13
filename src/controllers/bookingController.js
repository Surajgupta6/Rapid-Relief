const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const User = require('../models/User');

// Create a new booking
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
      dropLocation: dropLocation ? {
        type: 'Point',
        coordinates: dropLocation.coordinates,
        address: dropLocation.address
      } : {
        type: 'Point',
        coordinates: pickupLocation.coordinates, // Use pickup location as default
        address: 'To be determined'
      },
      status: 'pending'
    });

    // Emit socket event for new booking
    if (req.app.io) {
      const bookingData = {
        booking,
        totalDrivers: availableDrivers.length
      };
      
      // Emit to all drivers
      req.app.io.to('drivers').emit('newBookingAlert', bookingData);
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
      message: err.message
    });
  }
};

// Helper function to calculate fare based on distance
function calculateFare(pickupCoords, dropCoords) {
  // Calculate distance between two coordinates using Haversine formula
  const R = 6371; // Radius of the Earth in km
  const dLat = (dropCoords[1] - pickupCoords[1]) * Math.PI / 180;
  const dLon = (dropCoords[0] - pickupCoords[0]) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pickupCoords[1] * Math.PI / 180) * Math.cos(dropCoords[1] * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km

  // Base fare + distance based fare (example calculation)
  const baseFare = 100;
  const ratePerKm = 15;
  return Math.round(baseFare + (distance * ratePerKm));
}

// Get all bookings for current user
exports.getUserBookings = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ 
        status: 'error',
        message: 'You are not logged in' 
      });
    }

    const bookings = await Booking.find({ user: req.session.user.id })
      .populate('driver', 'name vehicleNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: {
        bookings
      }
    });
  } catch (err) {
    console.error('Error fetching user bookings:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch bookings'
    });
  }
};

// Get all bookings for current driver
exports.getDriverBookings = async (req, res) => {
  try {
    // Proper authentication check
    if (!req.session?.user || req.session?.user?.role !== 'driver' || !req.session?.user?.driverId) {
      console.log('Driver bookings access denied:', {
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        role: req.session?.user?.role,
        driverId: req.session?.user?.driverId
      });
      return res.status(401).json({
        status: 'error',
        message: 'Driver authentication required'
      });
    }

    const bookings = await Booking.find({ 
      $or: [
        { driver: req.session.user.driverId },
        { 
          status: 'pending',
          driver: { $exists: false } // Only show pending bookings that haven't been accepted by any driver
        }
      ]
    })
    .populate({
      path: 'user',
      select: 'name phone'
    })
    .populate('pickupLocation')
    .populate('dropLocation')
    .sort({ createdAt: -1 });

    console.log(`Found ${bookings.length} bookings for driver ${req.session.user.driverId}`);

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: {
        bookings
      }
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

// Driver accepts booking
exports.acceptBooking = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    
    // Get driver ID from session
    if (!req.session.user || !req.session.user.driverId) {
      return res.status(401).json({
        status: 'error',
        message: 'Driver not found in session'
      });
    }

    const driverId = req.session.user.driverId;

    // Get driver details including hospital
    const driver = await Driver.findById(driverId).populate('hospital');
    if (!driver) {
      return res.status(404).json({
        status: 'error',
        message: 'Driver not found'
      });
    }

    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: 'This booking cannot be accepted as it is not in pending status'
      });
    }

    // Update booking with driver and hospital information
    booking.status = 'accepted';
    booking.driver = driverId;
    booking.hospital = driver.hospital._id; // Add hospital reference
    booking.acceptedAt = Date.now();
    
    await booking.save();

    // Update driver's availability
    await Driver.findByIdAndUpdate(driverId, {
      isAvailable: false,
      currentBooking: bookingId
    });

    // Emit socket event for real-time updates
    if (req.app.io) {
      req.app.io.emit('bookingAccepted', {
        bookingId: booking._id,
        driverId: driverId,
        driverName: driver.name,
        hospitalId: driver.hospital._id,
        vehicleInfo: `${driver.ambulanceDetails.model} (${driver.ambulanceDetails.registrationNumber})`
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking accepted successfully',
      data: {
        booking
      }
    });
  } catch (error) {
    console.error('Error accepting booking:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to accept booking'
    });
  }
};

// Update booking status (in progress, completed)
exports.updateBookingStatus = async (req, res) => {
  try {
    // Fix the authentication check logic
    if (!req.session?.user?.role === 'driver' || !req.session?.user?.driverId) {
      console.log('Status update denied:', {
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        role: req.session?.user?.role,
        driverId: req.session?.user?.driverId
      });
      return res.status(401).json({
        status: 'error',
        message: 'Driver authentication required'
      });
    }

    const { status } = req.body;
    const allowedStatuses = ['inProgress', 'completed'];

    if (!status) {
      return res.status(400).json({
        status: 'error',
        message: 'Status is required'
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid status. Allowed values are: ${allowedStatuses.join(', ')}`
      });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if the booking is assigned to the current driver
    if (booking.driver?.toString() !== req.session.user.driverId) {
      return res.status(403).json({
        status: 'error',
        message: 'This booking is not assigned to you'
      });
    }

    // Validate status transition
    const validTransitions = {
      'accepted': ['inProgress'],
      'inProgress': ['completed']
    };

    if (!validTransitions[booking.status] || !validTransitions[booking.status].includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot change status from '${booking.status}' to '${status}'. Valid transitions from '${booking.status}' are: ${validTransitions[booking.status]?.join(', ') || 'none'}`
      });
    }

    // Update booking status and timestamps
    booking.status = status;
    if (status === 'inProgress') {
      booking.startedAt = Date.now();
    } else if (status === 'completed') {
      booking.completedAt = Date.now();
    }
    
    await booking.save();

    // If completed, update driver availability
    if (status === 'completed') {
      await Driver.findByIdAndUpdate(req.session.user.driverId, {
        isAvailable: true,
        currentBooking: null
      });

      console.log(`Driver ${req.session.user.driverId} marked as available after completing booking ${booking._id}`);
    } else if (status === 'inProgress') {
      // Update driver availability when starting trip
      await Driver.findByIdAndUpdate(req.session.user.driverId, {
        isAvailable: false,
        currentBooking: booking._id
      });

      console.log(`Driver ${req.session.user.driverId} marked as unavailable after starting booking ${booking._id}`);
    }

    // Get driver details for socket emission
    const driver = await Driver.findById(req.session.user.driverId)
      .populate('user', 'name')
      .populate('hospital', 'name');

    // Emit socket event for real-time updates
    if (req.app.io) {
      req.app.io.emit('bookingStatusUpdated', {
        bookingId: booking._id,
        status: status,
        driverId: req.session.user.driverId,
        driverName: driver.user.name,
        hospitalName: driver.hospital.name,
        timestamp: Date.now(),
        isTripInProgress: status === 'inProgress'
      });
    }

    res.status(200).json({
      status: 'success',
      message: `Booking status updated to ${status} successfully`,
      data: {
        booking
      }
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

// Cancel booking
exports.cancelBooking = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Check if user is authorized to cancel this booking
    if (booking.user.toString() !== req.session.user.id && 
        (req.session.user.role !== 'driver' || booking.driver?.toString() !== req.session.user.driverId)) {
      return res.status(403).json({ message: 'You are not authorized to cancel this booking' });
    }

    // Can only cancel if booking is pending or accepted
    if (!['pending', 'accepted'].includes(booking.status)) {
      return res.status(400).json({
        message: `Cannot cancel booking that is ${booking.status}`
      });
    }

    // Update booking status
    booking.status = 'cancelled';
    await booking.save();

    // If driver was assigned, update driver availability
    if (booking.driver) {
      await Driver.findByIdAndUpdate(booking.driver, {
        isAvailable: true,
        currentBooking: null
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        booking
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Rate and provide feedback for a booking
exports.rateBooking = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        message: 'Please provide a valid rating between 1 and 5'
      });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.user.toString() !== req.session.user.id) {
      return res.status(403).json({ message: 'You can only rate your own bookings' });
    }

    if (booking.status !== 'completed') {
      return res.status(400).json({
        message: 'You can only rate completed bookings'
      });
    }

    // Update booking
    booking.rating = rating;
    booking.feedback = feedback || '';
    await booking.save();

    // Update driver rating
    if (booking.driver) {
      const driver = await Driver.findById(booking.driver);
      if (driver) {
        const newTotalRatings = driver.totalRatings + 1;
        const newRating = ((driver.rating * driver.totalRatings) + rating) / newTotalRatings;
        
        driver.rating = newRating;
        driver.totalRatings = newTotalRatings;
        await driver.save();
      }
    }

    res.status(200).json({
      status: 'success',
      data: {
        booking
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Driver declines booking
exports.declineBooking = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    
    // Get driver ID from session
    if (!req.session.user || !req.session.user.driverId) {
      return res.status(401).json({
        status: 'error',
        message: 'Driver not found in session'
      });
    }

    const driverId = req.session.user.driverId;

    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: 'This booking cannot be declined as it is not in pending status'
      });
    }

    booking.status = 'declined';
    booking.declinedBy = booking.declinedBy || [];
    booking.declinedBy.push(driverId);
    booking.declinedAt = Date.now();
    
    await booking.save();

    // Emit socket event for real-time updates
    if (req.app.io) {
      req.app.io.emit('bookingDeclined', {
        bookingId: booking._id,
        driverId: driverId
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking declined successfully',
      data: {
        booking
      }
    });
  } catch (error) {
    console.error('Error declining booking:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to decline booking'
    });
  }
};

// Get current booking for driver
exports.getDriverCurrentBooking = async (req, res) => {
  try {
    // Check for valid driver session
    if (!req.session?.user?.role === 'driver' || !req.session?.user?.driverId) {
      console.log('Current booking access denied:', {
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        role: req.session?.user?.role,
        driverId: req.session?.user?.driverId
      });
      return res.status(401).json({
        status: 'error',
        message: 'Driver authentication required'
      });
    }

    const driverId = req.session.user.driverId;

    // Find the most recent active booking for this driver
    const currentBooking = await Booking.findOne({
      driver: driverId,
      status: { $in: ['accepted', 'inProgress'] }
    })
    .sort({ createdAt: -1 })
    .populate('user', 'name phone')
    .populate('pickup')
    .populate('dropoff')
    .lean();  // Convert to plain object for better performance

    console.log(`Current booking check for driver ${driverId}:`, currentBooking ? 'Found' : 'None');

    return res.status(200).json({
      status: 'success',
      data: {
        booking: currentBooking || null
      }
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

// Handle anonymous ambulance request
exports.createAnonymousRequest = async (req, res) => {
  try {
    const { coordinates, timestamp } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid coordinates provided'
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

    // Create anonymous booking with proper GeoJSON format
    const booking = await Booking.create({
      type: 'anonymous',
      isAnonymous: true, // Add explicit flag for anonymous requests
      pickupLocation: {
        type: 'Point',
        coordinates: coordinates,
        address: 'Emergency Location' // Changed from 'Anonymous Location' to be more descriptive
      },
      dropLocation: {
        type: 'Point',
        coordinates: coordinates,
        address: 'To be determined'
      },
      status: 'pending',
      createdAt: timestamp || Date.now()
    });

    // Emit socket event for new anonymous request
    if (req.app.io) {
      const requestData = {
        booking,
        totalDrivers: availableDrivers.length,
        isAnonymous: true // Add flag to indicate this is an anonymous request
      };
      
      // Emit to all drivers
      req.app.io.to('drivers').emit('anonymousRequestAlert', requestData);
    }

    res.status(200).json({
      status: 'success',
      message: 'Anonymous request sent successfully to all available drivers',
      data: {
        booking,
        totalDrivers: availableDrivers.length
      }
    });
  } catch (err) {
    console.error('Anonymous request error:', err);
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
}; 
const Driver = require('../models/Driver');
const User = require('../models/User');
const DriverStatus = require('../models/DriverStatus');
const Booking = require('../models/Booking');
const catchAsync = require('../utils/catchAsync');
const Hospital = require('../models/Hospital');

// Update driver location
exports.updateLocation = async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver') {
      return res.status(401).json({ message: 'You are not authorized' });
    }

    const { coordinates } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({
        message: 'Please provide valid coordinates [longitude, latitude]'
      });
    }

    const driver = await Driver.findById(req.session.user.driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // Update location
    driver.location.coordinates = coordinates;
    await driver.save();

    // Emit socket event for real-time updates - handled in the client
    
    res.status(200).json({
      status: 'success',
      data: {
        location: driver.location
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Get driver profile
exports.getProfile = async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver') {
      return res.status(401).json({ message: 'You are not authorized' });
    }

    const driver = await Driver.findById(req.session.user.driverId).populate('user', 'name email phone address');
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    res.status(200).json({
      status: 'success',
      data: {
        driver
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Update driver profile
exports.updateProfile = async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver') {
      return res.status(401).json({ message: 'You are not authorized' });
    }

    const {
      name,
      phone,
      address,
      licenseNumber,
      registrationNumber,
      model,
      capacity,
      features
    } = req.body;

    // Update user information
    if (name || phone || address) {
      const updateFields = {};
      if (name) updateFields.name = name;
      if (phone) updateFields.phone = phone;
      if (address) updateFields.address = address;

      await User.findByIdAndUpdate(req.session.user.id, updateFields);
    }

    // Update driver information
    const updateFields = {};
    if (licenseNumber) updateFields.licenseNumber = licenseNumber;
    
    // Update ambulance details
    if (registrationNumber || model || capacity || features) {
      updateFields.ambulanceDetails = {};
      
      const driver = await Driver.findById(req.session.user.driverId);
      
      updateFields.ambulanceDetails.registrationNumber = registrationNumber || driver.ambulanceDetails.registrationNumber;
      updateFields.ambulanceDetails.model = model || driver.ambulanceDetails.model;
      updateFields.ambulanceDetails.capacity = capacity || driver.ambulanceDetails.capacity;
      
      if (features) {
        updateFields.ambulanceDetails.features = features.split(',').map(feature => feature.trim());
      } else {
        updateFields.ambulanceDetails.features = driver.ambulanceDetails.features;
      }
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      req.session.user.driverId,
      updateFields,
      { new: true }
    ).populate('user', 'name email phone address');

    res.status(200).json({
      status: 'success',
      data: {
        driver: updatedDriver
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Get nearby drivers for the map
exports.getNearbyDrivers = async (req, res) => {
  try {
    const { coordinates, maxDistance = 5000 } = req.body; // Default 5km

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({
        message: 'Please provide valid coordinates [longitude, latitude]'
      });
    }

    const nearbyDrivers = await Driver.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates
          },
          $maxDistance: maxDistance // meters
        }
      }
    }).populate('user', 'name');

    res.status(200).json({
      status: 'success',
      results: nearbyDrivers.length,
      data: {
        drivers: nearbyDrivers
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Get registration page
exports.getRegisterPage = async (req, res) => {
    try {
        // Fetch all registered hospitals
        const hospitals = await Hospital.find({});
        res.render('auth/register-driver', { 
            error: null,
            hospitals 
        });
    } catch (error) {
        console.error('Error fetching hospitals:', error);
        res.render('auth/register-driver', { 
            error: 'Error loading registration form',
            hospitals: [] 
        });
    }
};

// Register driver
exports.register = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            confirmPassword,
            contactNumber,
            licenseNumber,
            hospital,
            vehicleType,
            ambulanceDetails
        } = req.body;

        // Check if passwords match
        if (password !== confirmPassword) {
            const hospitals = await Hospital.find({});
            return res.render('auth/driver/register', { 
                error: 'Passwords do not match',
                hospitals
            });
        }

        // Check if driver already exists
        const existingDriver = await Driver.findOne({ 
            $or: [
                { email },
                { licenseNumber },
                { 'ambulanceDetails.registrationNumber': ambulanceDetails.registrationNumber }
            ]
        });
        if (existingDriver) {
            const hospitals = await Hospital.find({});
            return res.render('auth/driver/register', { 
                error: existingDriver.email === email ? 
                    'A driver with this email already exists' : 
                    existingDriver.licenseNumber === licenseNumber ?
                    'A driver with this license number already exists' :
                    'A driver with this ambulance registration number already exists',
                hospitals
            });
        }

        // Verify that the selected hospital exists
        const selectedHospital = await Hospital.findById(hospital);
        if (!selectedHospital) {
            const hospitals = await Hospital.find({});
            return res.render('auth/driver/register', { 
                error: 'Selected hospital not found',
                hospitals
            });
        }

        // Create new user first
        const user = new User({
            name,
            email,
            password,
            role: 'driver',
            phone: contactNumber,
            address: 'To be updated'
        });
        await user.save();

        // Create new driver with user reference
        const driver = new Driver({
            user: user._id,
            name,
            email,
            password,
            contactNumber,
            licenseNumber,
            vehicleNumber: ambulanceDetails.registrationNumber,
            vehicleType,
            hospital: selectedHospital._id,
            location: {
                type: 'Point',
                coordinates: [0, 0]
            },
            isAvailable: true,
            status: 'available',
            ambulanceDetails: {
                registrationNumber: ambulanceDetails.registrationNumber,
                capacity: parseInt(ambulanceDetails.capacity),
                features: []
            }
        });

        // Save the driver
        await driver.save();

        // Create session with all necessary information
        req.session.user = {
            id: user._id,
            name: user.name,
            email: user.email,
            role: 'driver',
            hospital: driver.hospital,
            isVerified: driver.isVerified,
            driverId: driver._id
        };

        // Save session before redirecting
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.render('auth/driver/register', {
                    error: 'Error creating session. Please try again.',
                    hospitals: []
                });
            }
            // Redirect to dashboard
            res.redirect('/driver/dashboard');
        });

    } catch (error) {
        console.error('Driver registration error:', error);
        const hospitals = await Hospital.find({});
        res.render('auth/driver/register', { 
            error: error.message || 'An error occurred during registration',
            hospitals
        });
    }
};

// Get login page
exports.getLoginPage = async (req, res) => {
    res.render('auth/driver/login', { error: null });
};

// Login driver
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        console.log('Login attempt for email:', email);

        // First find the user
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            console.log('User not found for email:', email);
            return res.render('auth/driver/login', { 
                error: 'Invalid email or password'
            });
        }

        console.log('User found:', { userId: user._id, role: user.role });

        // Verify password using comparePassword method
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            console.log('Invalid password for user:', user._id);
            return res.render('auth/driver/login', { 
                error: 'Invalid email or password'
            });
        }

        console.log('Password verified for user:', user._id);

        // Find the associated driver profile
        const driver = await Driver.findOne({ user: user._id });
        if (!driver) {
            console.log('Driver profile not found for user:', user._id);
            return res.render('auth/driver/login', { 
                error: 'Driver profile not found. Please complete registration.'
            });
        }

        console.log('Driver profile found:', { driverId: driver._id });

        // Create session with all necessary information
        const sessionData = {
            id: user._id,
            name: user.name,
            email: user.email,
            role: 'driver',
            hospital: driver.hospital,
            isVerified: driver.isVerified,
            driverId: driver._id
        };

        console.log('Setting session data:', sessionData);

        req.session.user = sessionData;

        // Save session before redirecting
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.render('auth/driver/login', {
                    error: 'Error creating session. Please try again.'
                });
            }
            
            // Log successful login
            console.log('Driver logged in successfully:', {
                userId: user._id,
                driverId: driver._id,
                email: user.email
            });
            
            // Redirect to dashboard
            res.redirect('/driver/dashboard');
        });

    } catch (error) {
        console.error('Driver login error details:', {
            message: error.message,
            stack: error.stack,
            email: req.body.email
        });
        
        res.render('auth/driver/login', { 
            error: 'An error occurred during login. Please try again.'
        });
    }
};

// Logout driver
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({
                status: 'error',
                message: 'Error logging out'
            });
        }
        res.redirect('/');
    });
};

// Get driver dashboard
exports.getDashboard = catchAsync(async (req, res) => {
    try {
        // Check if user is authenticated and is a driver
        if (!req.session.user || req.session.user.role !== 'driver') {
            return res.redirect('/driver/login');
        }

        // Get driver profile using the driverId from session
        const driver = await Driver.findById(req.session.user.driverId)
            .populate('hospital', 'name address contactNumber')
            .select('+password'); // Include password for verification if needed

        if (!driver) {
            // If driver not found, clear session and redirect to login
            req.session.destroy((err) => {
                if (err) {
                    console.error('Session destroy error:', err);
                }
                return res.redirect('/driver/login');
            });
            return;
        }

        // Get driver's recent bookings including anonymous bookings
        const bookings = await Booking.find({
            $or: [
                { driver: req.session.user.driverId },
                { 
                    isAnonymous: true,
                    status: { $in: ['pending', 'accepted', 'inProgress'] }
                }
            ]
        })
        .populate('user', 'name contactNumber')
        .sort('-createdAt')
        .limit(5);

        // Render dashboard with driver data
        res.render('driver/dashboard', { 
            driver,
            bookings,
            error: null
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        // If there's an error, clear the session and redirect to login
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destroy error:', err);
            }
        });
        res.redirect('/driver/login');
    }
});

// Update driver availability
exports.updateAvailability = catchAsync(async (req, res) => {
    if (!req.session.user || !req.session.user.driverId) {
        return res.status(401).json({
            status: 'error',
            message: 'Driver authentication required'
        });
    }

    const { isAvailable } = req.body;
    const driver = await Driver.findById(req.session.user.driverId);
    
    if (!driver) {
        return res.status(404).json({
            status: 'error',
            message: 'Driver not found'
        });
    }
    
    driver.isAvailable = isAvailable;
    await driver.save();

    res.status(200).json({
        status: 'success',
        data: {
            driver
        }
    });
});

// Get driver's bookings for hospital view
exports.getDriverBookings = catchAsync(async (req, res) => {
    if (!req.session.user || !req.session.user.driverId) {
        return res.status(401).json({
            status: 'error',
            message: 'Driver authentication required'
        });
    }

    const driver = await Driver.findById(req.session.user.driverId);
    if (!driver) {
        return res.status(404).json({
            status: 'error',
            message: 'Driver not found'
        });
    }
    
    // Get all bookings for this driver including anonymous bookings
    const bookings = await Booking.find({
        $or: [
            { driver: req.session.user.driverId },
            { 
                isAnonymous: true,
                status: { $in: ['pending', 'accepted', 'inProgress'] }
            }
        ]
    })
    .populate('user', 'name contactNumber')
    .populate('driver', 'name contactNumber')
    .sort('-createdAt');

    res.json({
        status: 'success',
        data: {
            driver,
            bookings
        }
    });
});

// Accept booking
exports.acceptBooking = catchAsync(async (req, res) => {
    const { bookingId } = req.params;
    const driverId = req.session.user.id;

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
            message: 'Booking is no longer available'
        });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
        return res.status(404).json({
            status: 'error',
            message: 'Driver not found'
        });
    }

    // Update booking
    booking.driver = driverId;
    booking.status = 'accepted';
    await booking.save();

    // Emit booking accepted event with driver info
    req.app.get('io').emit('bookingStatusChanged', {
        bookingId: booking._id,
        status: 'accepted',
        driver: {
            _id: driver._id,
            name: driver.name,
            contactNumber: driver.contactNumber,
            vehicleNumber: driver.vehicleNumber,
            location: driver.location
        }
    });

    // Start sending location updates
    const locationUpdateInterval = setInterval(async () => {
        const updatedDriver = await Driver.findById(driverId);
        if (updatedDriver && updatedDriver.location) {
            // Calculate ETA (simplified version - you might want to use a proper routing service)
            const distance = calculateDistance(
                updatedDriver.location.coordinates,
                booking.pickupLocation.coordinates
            );
            const eta = Math.ceil(distance / 0.5); // Assuming average speed of 30 km/h (0.5 km/min)

            req.app.get('io').emit('driverLocationUpdate', {
                bookingId: booking._id,
                coordinates: updatedDriver.location.coordinates,
                eta: `${eta} minutes`
            });
        }
    }, 10000); // Update every 10 seconds

    // Store the interval ID in the booking object for cleanup
    booking.locationUpdateInterval = locationUpdateInterval;
    await booking.save();

    res.status(200).json({
        status: 'success',
        data: {
            booking
        }
    });
});

// Helper function to calculate distance between two points
function calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    const dLat = (point2[1] - point1[1]) * Math.PI / 180;
    const dLon = (point2[0] - point1[0]) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(point1[1] * Math.PI / 180) * Math.cos(point2[1] * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
} 
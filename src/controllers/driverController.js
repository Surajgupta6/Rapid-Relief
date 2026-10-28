const Driver = require('../models/Driver');
const User = require('../models/User');
const Booking = require('../models/Booking');
const catchAsync = require('../utils/catchAsync');
const Hospital = require('../models/Hospital');

// ─── Update driver location ───────────────────────────────────────────────────
exports.updateLocation = async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver') {
      return res.status(401).json({ message: 'You are not authorised' });
    }

    const { coordinates } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ message: 'Please provide valid coordinates [longitude, latitude]' });
    }

    // Basic coordinate range validation
    const [lng, lat] = coordinates;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return res.status(400).json({ message: 'Coordinates out of valid range' });
    }

    const driver = await Driver.findById(req.session.user.driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    driver.location.coordinates = coordinates;
    await driver.save();

    res.status(200).json({ status: 'success', data: { location: driver.location } });
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update location',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Get driver profile ───────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver') {
      return res.status(401).json({ message: 'You are not authorised' });
    }

    const driver = await Driver.findById(req.session.user.driverId).populate(
      'user',
      'name email phone address'
    );
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    res.status(200).json({ status: 'success', data: { driver } });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve driver profile',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Update driver profile ────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver') {
      return res.status(401).json({ message: 'You are not authorised' });
    }

    const { name, phone, address, licenseNumber, registrationNumber, model, capacity, features } = req.body;

    // Update User document fields
    if (name || phone || address) {
      const updateFields = {};
      if (name) updateFields.name = name;
      if (phone) updateFields.phone = phone;
      if (address) updateFields.address = address;
      await User.findByIdAndUpdate(req.session.user.id, updateFields);
    }

    // Build Driver document update
    const updateFields = {};
    if (licenseNumber) updateFields.licenseNumber = licenseNumber;

    if (registrationNumber || model || capacity || features) {
      const driver = await Driver.findById(req.session.user.driverId);
      updateFields.ambulanceDetails = {
        registrationNumber: registrationNumber || driver.ambulanceDetails.registrationNumber,
        model: model || driver.ambulanceDetails.model,
        capacity: capacity ? parseInt(capacity) : driver.ambulanceDetails.capacity,
        features: features
          ? features.split(',').map((f) => f.trim())
          : driver.ambulanceDetails.features
      };
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      req.session.user.driverId,
      updateFields,
      { new: true }
    ).populate('user', 'name email phone address');

    res.status(200).json({ status: 'success', data: { driver: updatedDriver } });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update driver profile',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Get nearby drivers ───────────────────────────────────────────────────────
exports.getNearbyDrivers = async (req, res) => {
  try {
    const { coordinates, maxDistance = 5000 } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ message: 'Please provide valid coordinates [longitude, latitude]' });
    }

    // Cap the search radius to prevent full-table geospatial scans
    const cappedDistance = Math.min(Number(maxDistance), 50000); // max 50 km

    const nearbyDrivers = await Driver.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates },
          $maxDistance: cappedDistance
        }
      }
    }).populate('user', 'name');

    res.status(200).json({
      status: 'success',
      results: nearbyDrivers.length,
      data: { drivers: nearbyDrivers }
    });
  } catch (err) {
    console.error('Nearby drivers error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to find nearby drivers',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Render registration page ─────────────────────────────────────────────────
exports.getRegisterPage = async (req, res) => {
  try {
    const hospitals = await Hospital.find({});
    res.render('auth/register-driver', { error: null, hospitals });
  } catch (error) {
    console.error('Error fetching hospitals:', error);
    res.render('auth/register-driver', { error: 'Error loading registration form', hospitals: [] });
  }
};

// ─── Register a driver (web form) ────────────────────────────────────────────
// NOTE (DEF-005 / known issue): This creates both a User document and a Driver
// document, each with their own hashed password.  Login authenticates against
// User.password only.  Consolidation is tracked as Phase 2 work.
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

    if (password !== confirmPassword) {
      const hospitals = await Hospital.find({});
      return res.render('auth/driver/register', { error: 'Passwords do not match', hospitals });
    }

    const existingDriver = await Driver.findOne({
      $or: [
        { email },
        { licenseNumber },
        { 'ambulanceDetails.registrationNumber': ambulanceDetails.registrationNumber }
      ]
    });

    if (existingDriver) {
      const hospitals = await Hospital.find({});
      const errorMsg =
        existingDriver.email === email
          ? 'A driver with this email already exists'
          : existingDriver.licenseNumber === licenseNumber
            ? 'A driver with this license number already exists'
            : 'A driver with this ambulance registration number already exists';
      return res.render('auth/driver/register', { error: errorMsg, hospitals });
    }

    const selectedHospital = await Hospital.findById(hospital);
    if (!selectedHospital) {
      const hospitals = await Hospital.find({});
      return res.render('auth/driver/register', { error: 'Selected hospital not found', hospitals });
    }

    const user = new User({
      name,
      email,
      password,
      role: 'driver',
      phone: contactNumber,
      address: 'To be updated'
    });
    await user.save();

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
      location: { type: 'Point', coordinates: [0, 0] },
      isAvailable: true,
      status: 'available',
      ambulanceDetails: {
        registrationNumber: ambulanceDetails.registrationNumber,
        capacity: parseInt(ambulanceDetails.capacity),
        features: []
      }
    });
    await driver.save();

    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: 'driver',
      hospital: driver.hospital,
      isVerified: driver.isVerified,
      driverId: driver._id
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('auth/driver/register', {
          error: 'Error creating session. Please try again.',
          hospitals: []
        });
      }
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

// ─── Render login page ────────────────────────────────────────────────────────
exports.getLoginPage = async (req, res) => {
  res.render('auth/driver/login', { error: null });
};

// ─── Driver login (web form) ──────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.render('auth/driver/login', { error: 'Invalid email or password' });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.render('auth/driver/login', { error: 'Invalid email or password' });
    }

    const driver = await Driver.findOne({ user: user._id });
    if (!driver) {
      return res.render('auth/driver/login', {
        error: 'Driver profile not found. Please complete registration.'
      });
    }

    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: 'driver',
      hospital: driver.hospital,
      isVerified: driver.isVerified,
      driverId: driver._id
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('auth/driver/login', {
          error: 'Error creating session. Please try again.'
        });
      }
      res.redirect('/driver/dashboard');
    });
  } catch (error) {
    console.error('Driver login error:', error);
    res.render('auth/driver/login', { error: 'An error occurred during login. Please try again.' });
  }
};

// ─── Driver logout ────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ status: 'error', message: 'Error logging out' });
    }
    res.redirect('/');
  });
};

// ─── Driver dashboard ─────────────────────────────────────────────────────────
exports.getDashboard = catchAsync(async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver') {
      return res.redirect('/driver/login');
    }

    // NOTE: password is NOT selected here — the .select('+password') that was
    // previously present served no purpose and exposed a sensitive field.
    const driver = await Driver.findById(req.session.user.driverId).populate(
      'hospital',
      'name address contactNumber'
    );

    if (!driver) {
      req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        return res.redirect('/driver/login');
      });
      return;
    }

    const bookings = await Booking.find({
      $or: [
        { driver: req.session.user.driverId },
        { isAnonymous: true, status: { $in: ['pending', 'accepted', 'inProgress'] } }
      ]
    })
      .populate('user', 'name contactNumber')
      .sort('-createdAt')
      .limit(5);

    res.render('driver/dashboard', { driver, bookings, error: null });
  } catch (error) {
    console.error('Dashboard error:', error);
    req.session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
    });
    res.redirect('/driver/login');
  }
});

// ─── Update driver availability ───────────────────────────────────────────────
exports.updateAvailability = catchAsync(async (req, res) => {
  if (!req.session.user || !req.session.user.driverId) {
    return res.status(401).json({ status: 'error', message: 'Driver authentication required' });
  }

  const { isAvailable } = req.body;
  const driver = await Driver.findById(req.session.user.driverId);

  if (!driver) {
    return res.status(404).json({ status: 'error', message: 'Driver not found' });
  }

  driver.isAvailable = isAvailable;
  await driver.save();

  res.status(200).json({ status: 'success', data: { driver } });
});

// ─── Get driver's bookings (for hospital view) ────────────────────────────────
exports.getDriverBookings = catchAsync(async (req, res) => {
  if (!req.session.user || !req.session.user.driverId) {
    return res.status(401).json({ status: 'error', message: 'Driver authentication required' });
  }

  const driver = await Driver.findById(req.session.user.driverId);
  if (!driver) {
    return res.status(404).json({ status: 'error', message: 'Driver not found' });
  }

  const bookings = await Booking.find({
    $or: [
      { driver: req.session.user.driverId },
      { isAnonymous: true, status: { $in: ['pending', 'accepted', 'inProgress'] } }
    ]
  })
    .populate('user', 'name contactNumber')
    .populate('driver', 'name contactNumber')
    .sort('-createdAt');

  res.json({ status: 'success', data: { driver, bookings } });
});

const User = require('../models/User');
const Driver = require('../models/Driver');

// ─── Register a new user ──────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, address, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create a new user
    const user = await User.create({ name, email, password, phone, address, role });

    // If user is a driver, create driver profile
    let driverId = null;
    if (role === 'driver') {
      const { licenseNumber, registrationNumber, model, capacity, features } = req.body;
      const driver = await Driver.create({
        user: user._id,
        licenseNumber,
        ambulanceDetails: {
          registrationNumber,
          model,
          capacity: parseInt(capacity),
          features: features ? features.split(',').map((f) => f.trim()) : []
        },
        status: 'offline'
      });
      driverId = driver._id;
    }

    // Create session
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      driverId
    };

    res.status(201).json({
      status: 'success',
      data: {
        user: { id: user._id, name: user.name, email: user.email, role: user.role, driverId }
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Registration failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Register a driver (dedicated endpoint) ───────────────────────────────────
// NOTE (DEF-005 / known issue): Driver registration currently creates both a
// User document and a Driver document each with their own hashed password.
// The login flow authenticates against User.password only.  Consolidating the
// two into a single auth entity is tracked as Phase 2 work.
exports.registerDriver = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      address,
      licenseNumber,
      registrationNumber,
      model,
      capacity,
      features
    } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ status: 'error', message: 'A user already exists with this email' });
    }

    const existingDriver = await Driver.findOne({ licenseNumber });
    if (existingDriver) {
      return res.status(400).json({ status: 'error', message: 'A driver already exists with this license number' });
    }

    const user = await User.create({ name, email, password, phone, address, role: 'driver' });

    const driver = await Driver.create({
      user: user._id,
      licenseNumber,
      ambulanceDetails: {
        registrationNumber,
        model,
        capacity: parseInt(capacity),
        features: features ? features.split(',').map((f) => f.trim()) : []
      },
      status: 'offline'
    });

    req.session.user = {
      id: user._id,
      email: user.email,
      role: 'driver',
      name: user.name,
      driverId: driver._id
    };

    res.status(201).json({
      status: 'success',
      data: {
        user: { id: user._id, email: user.email, role: 'driver', name: user.name, driverId: driver._id }
      }
    });
  } catch (error) {
    console.error('Driver registration error:', error);

    // If user was created but driver creation failed, clean up the user
    if (error.code !== 11000 && req.session?.user?.id) {
      try {
        await User.findByIdAndDelete(req.session.user.id);
      } catch (cleanupError) {
        console.error('Failed to clean up user after driver creation error:', cleanupError);
      }
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ status: 'error', message: `This ${field} is already registered` });
    }

    res.status(500).json({
      status: 'error',
      message: 'An error occurred during registration. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      // Return the same message for both "not found" and "wrong password" to
      // prevent user enumeration.
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    let driverId = null;
    if (user.role === 'driver') {
      const driver = await Driver.findOne({ user: user._id });
      if (!driver) {
        return res.status(404).json({ message: 'Driver profile not found. Please complete your profile setup.' });
      }
      driverId = driver._id;
    }

    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      driverId
    };

    res.status(200).json({
      status: 'success',
      data: {
        user: { id: user._id, name: user.name, email: user.email, role: user.role, driverId }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Login failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({ status: 'error', message: 'Error logging out' });
    }
    res.status(200).json({ status: 'success', message: 'You have successfully logged out' });
  });
};

// ─── Get current user ─────────────────────────────────────────────────────────
exports.getCurrentUser = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    const user = await User.findById(req.session.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          driverId: req.session.user.driverId
        }
      }
    });
  } catch (err) {
    console.error('Get current user error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve user information.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

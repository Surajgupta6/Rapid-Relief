const User = require('../models/User');
const Driver = require('../models/Driver');

// Register a new user
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, address, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create a new user
    const user = await User.create({
      name,
      email,
      password,
      phone,
      address,
      role
    });

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
          features: features ? features.split(',').map(f => f.trim()) : []
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
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          driverId
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Register a driver
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

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        status: 'error',
        message: 'A user already exists with this email' 
      });
    }

    // Check if license number is already registered
    const existingDriver = await Driver.findOne({ licenseNumber });
    if (existingDriver) {
      return res.status(400).json({ 
        status: 'error',
        message: 'A driver already exists with this license number' 
      });
    }

    // Create new user with driver role
    const user = await User.create({
      name,
      email,
      password,
      phone,
      address,
      role: 'driver'
    });

    // Create new driver document
    const driver = await Driver.create({
      user: user._id,
      licenseNumber,
      ambulanceDetails: {
        registrationNumber,
        model,
        capacity: parseInt(capacity),
        features: features ? features.split(',').map(f => f.trim()) : []
      },
      status: 'offline'
    });

    // Update session with driver data
    req.session.user = {
      id: user._id,
      email: user.email,
      role: 'driver',
      name: user.name,
      driverId: driver._id
    };

    console.log('Driver registered successfully:', {
      userId: user._id,
      driverId: driver._id,
      email: user.email
    });

    res.status(201).json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: 'driver',
          name: user.name,
          driverId: driver._id
        }
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

    // Send appropriate error message
    if (error.code === 11000) {
      // Duplicate key error
      const field = Object.keys(error.keyPattern)[0];
      res.status(400).json({
        status: 'error',
        message: `This ${field} is already registered`
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: 'An error occurred during registration. Please try again.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists and explicitly select password field
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // If user is a driver, get their driver profile
    let driverId = null;
    if (user.role === 'driver') {
      const driver = await Driver.findOne({ user: user._id });
      if (!driver) {
        return res.status(404).json({ message: 'Driver profile not found. Please complete your profile setup.' });
      }
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

    res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          driverId
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Logout
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        status: 'error',
        message: 'Error logging out'
      });
    }
    res.status(200).json({
      status: 'success',
      message: 'You have successfully logged out'
    });
  });
};

// Get current user
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
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
}; 
// Check if user is authenticated
exports.isAuthenticated = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'You are not logged in' });
  }
  next();
};

// Check if user is a driver
exports.isDriver = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'driver') {
    return res.status(403).json({ message: 'Access denied. Only drivers can access this route' });
  }
  next();
};

// Check if user is a regular user (not driver or admin)
exports.isUser = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(403).json({ message: 'Access denied. Only users can access this route' });
  }
  next();
};

// Check if user is an admin
exports.isAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Only admins can access this route' });
  }
  next();
};

// Middleware for routes that should redirect to login page
exports.requireAuth = (req, res, next) => {
  if (!req.session.user) {
    // Store the requested URL for redirection after login
    const redirect = req.originalUrl;
    return res.redirect(`/login?redirect=${redirect}`);
  }
  next();
};

// Middleware to protect routes and handle authentication
exports.protect = (req, res, next) => {
  if (!req.session.user) {
    // Store the requested URL for redirection after login
    const redirect = req.originalUrl;
    return res.redirect(`/login?redirect=${redirect}`);
  }
  next();
};

// Check if user is a hospital
exports.isHospital = (req, res, next) => {
  if (!req.session.hospital || !req.session.hospital.id) {
    return res.redirect('/hospital/login');
  }
  next();
};

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // Check if user exists in session
    if (!req.session.user) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in'
      });
    }

    // Check if user role is allowed
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to perform this action'
      });
    }

    // Additional check for driver routes
    if (req.session.user.role === 'driver' && !req.session.user.driverId) {
      return res.status(403).json({
        status: 'error',
        message: 'Driver profile not found. Please complete registration.'
      });
    }

    next();
  };
}; 
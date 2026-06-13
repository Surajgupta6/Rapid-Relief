const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');

// Import controllers
// We'll add more user-specific controllers if needed

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'You are not logged in' });
  }
  next();
};

// User dashboard route
router.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('user/dashboard');
});

// User profile route
router.get('/profile', isAuthenticated, (req, res) => {
  res.render('user/profile', { user: req.session.user });
});

// User bookings history route
router.get('/bookings', isAuthenticated, async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.session.user.id })
      .populate('driver', 'name vehicleNumber')
      .sort({ createdAt: -1 });
    
    res.render('user/bookings', { 
      user: req.session.user,
      bookings: bookings
    });
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.render('user/bookings', { 
      user: req.session.user,
      error: 'Failed to load bookings. Please try again.'
    });
  }
});

// Update user profile
router.post('/update-profile', isAuthenticated, async (req, res) => {
  try {
    const { name, phone, address, currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    // Find the user
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Update basic info
    user.name = name;
    user.phone = phone;
    user.address = address;

    // If user wants to change password
    if (currentPassword && newPassword) {
      // Verify current password
      const isPasswordValid = await user.correctPassword(currentPassword, user.password);
      if (!isPasswordValid) {
        return res.status(400).json({ status: 'error', message: 'Current password is incorrect' });
      }

      // Validate new password
      if (newPassword.length < 8) {
        return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters' });
      }

      // Set new password
      user.password = newPassword;
    }

    // Save the user
    await user.save();

    // Update session info
    req.session.user.name = user.name;

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

module.exports = router; 
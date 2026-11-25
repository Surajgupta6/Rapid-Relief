const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');

// Inline auth check (the router is already mounted behind authMiddleware.protect
// in app.js, but this provides an additional explicit guard)
const isAuthenticated = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'You are not logged in' });
  }
  next();
};

// ── User dashboard ─────────────────────────────────────────────────────────────
router.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('user/dashboard');
});

// ── User profile page ──────────────────────────────────────────────────────────
router.get('/profile', isAuthenticated, (req, res) => {
  res.render('user/profile', { user: req.session.user });
});

// ── User booking history page ──────────────────────────────────────────────────
router.get('/bookings', isAuthenticated, async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.session.user.id })
      .populate('driver', 'name vehicleNumber')
      .sort({ createdAt: -1 });

    res.render('user/bookings', { user: req.session.user, bookings });
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.render('user/bookings', {
      user: req.session.user,
      bookings: [],
      error: 'Failed to load bookings. Please try again.'
    });
  }
});

// ── Update user profile ────────────────────────────────────────────────────────
router.post('/update-profile', isAuthenticated, async (req, res) => {
  try {
    const { name, phone, address, currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    user.name = name;
    user.phone = phone;
    user.address = address;

    // Password change is optional
    if (currentPassword && newPassword) {
      // FIX (DEF-006): the User model exposes comparePassword(candidate), not
      // correctPassword(candidate, hash).  Using the correct method name.
      const isPasswordValid = await user.comparePassword(currentPassword);
      if (!isPasswordValid) {
        return res.status(400).json({ status: 'error', message: 'Current password is incorrect' });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters' });
      }

      user.password = newPassword;
    }

    await user.save();

    // Keep session name in sync
    req.session.user.name = user.name;

    res.status(200).json({ status: 'success', message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update profile',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;

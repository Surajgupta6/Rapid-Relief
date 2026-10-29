const express = require('express');
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');
const { anonymousBookingLimiter } = require('../middleware/rateLimiters');
const {
  createBookingRules,
  anonymousBookingRules,
  handleValidationErrors
} = require('../middleware/validate');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────
// Anonymous emergency request — unauthenticated but rate-limited and validated.
router.post(
  '/anonymous-request',
  anonymousBookingLimiter,
  ...anonymousBookingRules,
  handleValidationErrors,
  bookingController.createAnonymousRequest
);

// ── Protected routes — require a valid session ────────────────────────────────
router.use(authMiddleware.protect);

// User — create a booking (DEF-007: inside protect so req.session.user is guaranteed)
router.post('/', ...createBookingRules, handleValidationErrors, bookingController.createBooking);

// User — own booking history
router.get('/user', bookingController.getUserBookings);

// Driver-only routes
router.get('/driver', authMiddleware.restrictTo('driver'), bookingController.getDriverBookings);
router.get('/driver/current', authMiddleware.restrictTo('driver'), bookingController.getDriverCurrentBooking);
router.post('/accept/:bookingId', authMiddleware.restrictTo('driver'), bookingController.acceptBooking);
router.post('/decline/:bookingId', authMiddleware.restrictTo('driver'), bookingController.declineBooking);
router.post('/:id/status', authMiddleware.restrictTo('driver'), bookingController.updateBookingStatus);

// Shared — accessible by the booking owner or the assigned driver
router.post('/:id/cancel', bookingController.cancelBooking);
router.post('/:id/rate', bookingController.rateBooking);

module.exports = router;

const express = require('express');
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');
const { anonymousBookingLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────
// Anonymous emergency request is unauthenticated but rate-limited to prevent
// flooding the driver notification queue.
router.post('/anonymous-request', anonymousBookingLimiter, bookingController.createAnonymousRequest);

// ── Protected routes — require a valid session ─────────────────────────────────
router.use(authMiddleware.protect);

// User — create a booking (FIX DEF-007: moved inside protect so req.session.user is guaranteed)
router.post('/', bookingController.createBooking);

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

const express = require('express');
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.post('/', bookingController.createBooking);
router.post('/anonymous-request', bookingController.createAnonymousRequest);

// Protected routes - require authentication
router.use(authMiddleware.protect);

// User routes
router.get('/user', bookingController.getUserBookings);

// Driver routes - require driver role
router.get('/driver', authMiddleware.restrictTo('driver'), bookingController.getDriverBookings);
router.get('/driver/current', authMiddleware.restrictTo('driver'), bookingController.getDriverCurrentBooking);
router.post('/accept/:bookingId', authMiddleware.restrictTo('driver'), bookingController.acceptBooking);
router.post('/decline/:bookingId', authMiddleware.restrictTo('driver'), bookingController.declineBooking);
router.post('/:id/status', authMiddleware.restrictTo('driver'), bookingController.updateBookingStatus);

// Common routes - accessible by both users and drivers
router.post('/:id/cancel', bookingController.cancelBooking);
router.post('/:id/rate', bookingController.rateBooking);

module.exports = router; 
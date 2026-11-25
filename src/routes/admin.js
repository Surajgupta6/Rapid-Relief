const express = require('express');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// All admin routes require: (1) a valid session AND (2) the 'admin' role.
router.use(authMiddleware.protect);
router.use(authMiddleware.restrictTo('admin'));

// ── Platform statistics ────────────────────────────────────────────────────────
router.get('/stats', adminController.getStats);

// ── Driver management ─────────────────────────────────────────────────────────
router.get('/drivers', adminController.listDrivers);
router.get('/drivers/stale', adminController.listStaleDrivers);
router.post('/drivers/:driverId/verify', adminController.verifyDriver);
router.post('/drivers/:driverId/revoke', adminController.revokeDriver);

// ── Booking management ────────────────────────────────────────────────────────
router.get('/bookings/stale', adminController.listStaleBookings);
router.post('/bookings/:bookingId/force-cancel', adminController.forceCancelBooking);

// ── Dispatch scoring transparency (Phase 8: Smart Dispatch Scoring) ───────────
// Returns the score snapshot from booking creation + a live re-score of
// currently available drivers.  Useful for debugging dispatch decisions.
router.get('/dispatch/scores/:bookingId', adminController.getDispatchScores);

module.exports = router;

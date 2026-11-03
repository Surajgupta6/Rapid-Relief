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
router.post('/drivers/:driverId/verify', adminController.verifyDriver);
router.post('/drivers/:driverId/revoke', adminController.revokeDriver);

module.exports = router;

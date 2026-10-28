const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospitalController');
const authMiddleware = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiters');

// ── Public auth pages ─────────────────────────────────────────────────────────
router.get('/register', hospitalController.getRegisterPage);
router.get('/login', hospitalController.getLoginPage);

// Rate-limit hospital login and registration form submissions
router.post('/register', authLimiter, hospitalController.register);
router.post('/login', authLimiter, hospitalController.login);
router.get('/logout', hospitalController.logout);

// ── Protected routes — require hospital session ───────────────────────────────
router.get('/dashboard', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.getDashboard);
router.patch('/update-beds', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.updateBedAvailability);
router.get('/ambulance-locations', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.getAmbulanceLocations);
router.patch('/update-location', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.updateLocation);

module.exports = router;

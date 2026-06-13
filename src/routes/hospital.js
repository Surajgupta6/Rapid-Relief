const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospitalController');
const authMiddleware = require('../middleware/authMiddleware');

// Auth routes
router.get('/register', hospitalController.getRegisterPage);
router.post('/register', hospitalController.register);
router.get('/login', hospitalController.getLoginPage);
router.post('/login', hospitalController.login);
router.get('/logout', hospitalController.logout);

// Protected routes
router.get('/dashboard', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.getDashboard);
router.patch('/update-beds', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.updateBedAvailability);

// Get ambulance locations
router.get('/ambulance-locations', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.getAmbulanceLocations);

// Update hospital location
router.patch('/update-location', authMiddleware.protect, authMiddleware.restrictTo('hospital'), hospitalController.updateLocation);

module.exports = router; 
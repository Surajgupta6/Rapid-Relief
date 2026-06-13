const express = require('express');
const driverController = require('../controllers/driverController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Driver dashboard
router.get('/dashboard', 
    authMiddleware.protect, 
    authMiddleware.restrictTo('driver'), 
    driverController.getDashboard
);

// Driver profile
router.get('/profile', 
    authMiddleware.protect, 
    authMiddleware.restrictTo('driver'), 
    driverController.getProfile
);

// Update driver profile
router.put('/profile', 
    authMiddleware.protect, 
    authMiddleware.restrictTo('driver'), 
    driverController.updateProfile
);

// Update driver location
router.put('/location', 
    authMiddleware.protect, 
    authMiddleware.restrictTo('driver'), 
    driverController.updateLocation
);

// Get nearby drivers
router.get('/nearby', 
    authMiddleware.protect, 
    authMiddleware.restrictTo('driver'), 
    driverController.getNearbyDrivers
);

// Get driver's bookings
router.get('/bookings', 
    authMiddleware.protect, 
    authMiddleware.restrictTo('driver'), 
    driverController.getDriverBookings
);

module.exports = router; 
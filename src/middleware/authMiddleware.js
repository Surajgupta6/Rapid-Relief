const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
    try {
        // Check if user is logged in
        if (!req.session || !req.session.user || !req.session.user.id) {
            console.log('Authentication failed: No valid session');
            return res.status(401).json({
                status: 'error',
                message: 'You are not logged in. Please log in to continue.'
            });
        }

        // Add user to request for convenience
        req.user = req.session.user;
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(401).json({
            status: 'error',
            message: 'Authentication failed'
        });
    }
};

exports.restrictTo = (...roles) => {
    return async (req, res, next) => {
        try {
            // First ensure user is authenticated
            if (!req.session || !req.session.user || !req.session.user.role) {
                console.log('Role restriction failed: No valid session or role');
                return res.status(401).json({
                    status: 'error',
                    message: 'Authentication required'
                });
            }

            // Log the user's role for debugging
            console.log(`RestrictTo middleware: Checking role for user ${req.session.user.id}, Role: ${req.session.user.role}`);

            // Check if user's role is included in the roles array
            if (!roles.includes(req.session.user.role)) {
                console.log(`Role restriction failed: User role ${req.session.user.role} not in allowed roles:`, roles);
                return res.status(403).json({
                    status: 'error',
                    message: 'You do not have permission to perform this action'
                });
            }

            // For drivers, ensure they have a complete profile
            if (req.session.user.role === 'driver') {
                console.log(`RestrictTo middleware: Driver check for user ${req.session.user.id}, DriverId: ${req.session.user.driverId}`);
                if (!req.session.user.driverId) {
                    console.log('Driver profile check failed: No driverId in session');
                    return res.status(403).json({
                        status: 'error',
                        message: 'Driver profile not found. Please complete your profile setup.'
                    });
                }
            }

            next();
        } catch (error) {
            console.error('Role restriction error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'An error occurred while checking permissions'
            });
        }
    };
}; 
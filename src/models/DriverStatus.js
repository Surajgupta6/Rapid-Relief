const mongoose = require('mongoose');

const driverStatusSchema = new mongoose.Schema({
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    currentLocation: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            default: [0, 0]
        }
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

driverStatusSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('DriverStatus', driverStatusSchema); 
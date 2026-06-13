const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.type !== 'anonymous';
    }
  },
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  },
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital'
  },
  type: {
    type: String,
    enum: ['regular', 'anonymous'],
    default: 'regular'
  },
  patientName: {
    type: String,
    required: function() {
      return this.type !== 'anonymous';
    }
  },
  patientContact: {
    type: String,
    required: function() {
      return this.type !== 'anonymous';
    }
  },
  medicalCondition: {
    type: String,
    required: function() {
      return this.type !== 'anonymous';
    }
  },
  pickupLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],  // [longitude, latitude]
      required: true,
      validate: {
        validator: function(v) {
          return Array.isArray(v) && v.length === 2 && 
                 typeof v[0] === 'number' && typeof v[1] === 'number';
        },
        message: 'Coordinates must be an array of two numbers [longitude, latitude]'
      }
    },
    address: String
  },
  dropLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],  // [longitude, latitude]
      required: function() {
        return this.type === 'regular';
      },
      validate: {
        validator: function(v) {
          if (this.type === 'anonymous') return true;
          return Array.isArray(v) && v.length === 2 && 
                 typeof v[0] === 'number' && typeof v[1] === 'number';
        },
        message: 'Coordinates must be an array of two numbers [longitude, latitude]'
      }
    },
    address: String
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'inProgress', 'completed', 'cancelled', 'declined'],
    default: 'pending'
  },
  fare: {
    type: Number
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'insurance'],
    default: 'cash'
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  feedback: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  scheduledTime: {
    type: Date
  },
  acceptedAt: Date,
  startedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  declinedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  }]
});

// Add indexes for better query performance
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ driver: 1, createdAt: -1 });
bookingSchema.index({ 'pickupLocation': '2dsphere' });
bookingSchema.index({ 'dropLocation': '2dsphere' });

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking; 
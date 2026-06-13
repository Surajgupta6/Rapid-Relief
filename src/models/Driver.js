const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const driverSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false
    },
    contactNumber: {
      type: String,
      required: [true, 'Contact number is required']
    },
    licenseNumber: {
      type: String,
      required: [true, 'License number is required'],
      unique: true
    },
    vehicleNumber: {
      type: String,
      required: [true, 'Vehicle number is required'],
      unique: true
    },
    vehicleType: {
      type: String,
      required: [true, 'Vehicle type is required'],
      enum: ['Basic', 'Advanced', 'Critical Care']
    },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      required: [true, 'Hospital information is required']
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: [true, 'Location coordinates are required']
      }
    },
    status: {
      type: String,
      enum: ['available', 'onDuty', 'onTheWay'],
      default: 'available'
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    ambulanceDetails: {
      registrationNumber: {
        type: String,
        required: [true, 'Ambulance registration number is required'],
        unique: true
      },
      capacity: {
        type: Number,
        required: [true, 'Ambulance capacity is required'],
        min: 1
      },
      features: [String]
    }
  },
  { timestamps: true }
);

// Create geospatial index for location-based queries
driverSchema.index({ location: '2dsphere' });

// Hash the password before saving
driverSchema.pre('save', async function(next) {
  // Only run this function if password was modified
  if (!this.isModified('password')) return next();

  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Method to check if entered password is correct
driverSchema.methods.correctPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver; 
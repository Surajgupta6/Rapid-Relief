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
    // NOTE (DEF-005): This password field is a known architectural issue —
    // drivers have credentials in both the User document and this Driver
    // document.  The active login flow authenticates against User.password
    // only.  Consolidation into a single auth entity is tracked as Phase 3.
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

    // ── Availability ────────────────────────────────────────────────────────
    isAvailable: {
      type: Boolean,
      default: true
    },
    // isVerified: set to true by an admin once credentials are validated.
    // An admin verification flow does not yet exist (Phase 3).
    isVerified: {
      type: Boolean,
      default: false
    },
    // currentBooking: the active booking this driver is handling.
    currentBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },

    // ── Location ────────────────────────────────────────────────────────────
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: [true, 'Location coordinates are required'],
        default: [0, 0]
      }
    },
    // locationSetAt: null until the driver sends their first GPS update.
    // Dispatch queries filter out null values so drivers who have never
    // reported their position are excluded from proximity searches.
    locationSetAt: {
      type: Date,
      default: null
    },

    // ── Status (granular, beyond the boolean isAvailable) ──────────────────
    status: {
      type: String,
      enum: ['available', 'onDuty', 'onTheWay'],
      default: 'available'
    },

    // ── Ambulance details ───────────────────────────────────────────────────
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
    },

    // ── Rating ──────────────────────────────────────────────────────────────
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    totalRatings: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
driverSchema.index({ location: '2dsphere' });
driverSchema.index({ isAvailable: 1, locationSetAt: 1 }); // Dispatch query support

// ── Password hashing ──────────────────────────────────────────────────────────
driverSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── Instance method ───────────────────────────────────────────────────────────
driverSchema.methods.correctPassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver;

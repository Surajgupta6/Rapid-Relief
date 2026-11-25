const mongoose = require('mongoose');

/**
 * Driver — one document per ambulance driver.
 *
 * Authentication: Drivers authenticate via the linked User document.
 * The Driver document holds operational data only (vehicle, location, status).
 *
 * DEF-005 (resolved in Phase 3): The old schema stored a redundant hashed
 * password on the Driver document alongside the canonical User.password.
 * Login and session creation have always used User.password exclusively.
 * The duplicate field is removed here; existing drivers are unaffected
 * because auth reads from User, not Driver.
 */
const driverSchema = new mongoose.Schema(
  {
    // ── Identity link ──────────────────────────────────────────────────────────
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true // one Driver doc per User account
    },

    // ── Personal details (denormalised from User for fast display) ─────────────
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
    contactNumber: {
      type: String,
      required: [true, 'Contact number is required']
    },

    // ── Credentials ────────────────────────────────────────────────────────────
    // NOTE: Driver.password intentionally removed (Phase 3 / DEF-005).
    // All authentication is performed against the linked User document.
    // Keeping password off this schema prevents accidental double-hashing
    // and removes an unnecessary attack surface.

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

    // ── Admin verification ─────────────────────────────────────────────────────
    // isVerified: must be set true by an admin before the driver appears in
    // dispatch queries and receives booking alerts.
    isVerified: {
      type: Boolean,
      default: false
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // the admin who approved this driver
      default: null
    },

    // ── Availability ───────────────────────────────────────────────────────────
    isAvailable: {
      type: Boolean,
      default: true
    },
    availabilityUpdatedAt: {
      type: Date,
      default: null // set whenever isAvailable changes
    },

    // currentBooking: the active booking this driver is handling.
    // Cleared to null on booking completion or cancellation.
    currentBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },

    // ── Location ───────────────────────────────────────────────────────────────
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

    // ── Status (granular, beyond the boolean isAvailable) ─────────────────────
    status: {
      type: String,
      enum: ['available', 'onDuty', 'onTheWay'],
      default: 'available'
    },

    // ── Ambulance details ──────────────────────────────────────────────────────
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

    // ── Rating ─────────────────────────────────────────────────────────────────
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
    },

    // ── Dispatch statistics (Phase 8: Smart Dispatch Scoring) ──────────────────
    // These counters feed the acceptance-rate factor in the scoring model.
    // acceptedCount: how many bookings this driver has accepted (all time).
    // declinedCount: how many bookings this driver has explicitly declined.
    // The ratio acceptedCount / (acceptedCount + declinedCount) is the
    // driver's acceptance rate — a reliability signal used by rankDrivers().
    acceptedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    declinedCount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
driverSchema.index({ location: '2dsphere' });
driverSchema.index({ isAvailable: 1, isVerified: 1, locationSetAt: 1 }); // Dispatch query support
driverSchema.index({ isVerified: 1 }); // Admin verification queries

// ── Pre-save: track when availability changes ──────────────────────────────────
driverSchema.pre('save', function (next) {
  if (this.isModified('isAvailable')) {
    this.availabilityUpdatedAt = new Date();
  }
  next();
});

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver;

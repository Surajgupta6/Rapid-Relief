const mongoose = require('mongoose');

/**
 * Booking — the central document for every ambulance request.
 *
 * Lifecycle (state machine):
 *
 *   pending ──► accepted ──► inProgress ──► completed
 *     │            │
 *     └────────────┴──────────────────────────────► cancelled
 *
 * A driver declining a booking does NOT change the status; it only pushes the
 * driver's ID onto `declinedBy` so that driver is excluded from future alerts.
 */
const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
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

    // ── Booking type ────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: ['regular', 'anonymous'],
      default: 'regular'
    },
    // isAnonymous mirrors type === 'anonymous' and is stored explicitly so
    // that queries on this flag are straightforward.
    isAnonymous: {
      type: Boolean,
      default: false
    },

    // ── Patient details (required for regular bookings) ───────────────────
    patientName: {
      type: String,
      required: function () {
        return this.type !== 'anonymous';
      },
      trim: true,
      maxlength: [100, 'Patient name cannot exceed 100 characters']
    },
    patientContact: {
      type: String,
      required: function () {
        return this.type !== 'anonymous';
      },
      trim: true
    },
    medicalCondition: {
      type: String,
      required: function () {
        return this.type !== 'anonymous';
      },
      trim: true,
      maxlength: [500, 'Medical condition cannot exceed 500 characters']
    },

    // ── Locations (GeoJSON Points) ────────────────────────────────────────
    pickupLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
        validate: {
          validator: function (v) {
            if (!Array.isArray(v) || v.length !== 2) return false;
            const [lng, lat] = v;
            return (
              typeof lng === 'number' && typeof lat === 'number' &&
              lng >= -180 && lng <= 180 &&
              lat >= -90 && lat <= 90
            );
          },
          message: 'pickupLocation coordinates must be [longitude(-180–180), latitude(-90–90)]'
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
        type: [Number], // [longitude, latitude]
        required: function () {
          return this.type === 'regular';
        },
        validate: {
          validator: function (v) {
            if (this.type === 'anonymous') return true;
            if (!Array.isArray(v) || v.length !== 2) return false;
            const [lng, lat] = v;
            return (
              typeof lng === 'number' && typeof lat === 'number' &&
              lng >= -180 && lng <= 180 &&
              lat >= -90 && lat <= 90
            );
          },
          message: 'dropLocation coordinates must be [longitude(-180–180), latitude(-90–90)]'
        }
      },
      address: String
    },

    // ── Status ─────────────────────────────────────────────────────────────
    status: {
      type: String,
      // 'declined' removed: declining a booking no longer changes its status.
      // See declinedBy below.
      enum: ['pending', 'accepted', 'inProgress', 'completed', 'cancelled'],
      default: 'pending'
    },

    // ── Fare and payment ──────────────────────────────────────────────────
    fare: { type: Number, min: 0 },
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

    // ── Rating ────────────────────────────────────────────────────────────
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String, trim: true },

    // ── Scheduling ────────────────────────────────────────────────────────
    scheduledTime: Date,

    // ── Lifecycle timestamps ──────────────────────────────────────────────
    acceptedAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,

    // ── Decline tracking ──────────────────────────────────────────────────
    // Drivers who have declined this booking.  The booking remains 'pending'
    // so other drivers can still claim it.
    declinedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Driver'
      }
    ]
  },
  {
    // Adds createdAt and updatedAt automatically; updatedAt refreshes on
    // every save so we always know when the booking was last modified.
    timestamps: true
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ driver: 1, createdAt: -1 });
bookingSchema.index({ type: 1, status: 1 }); // Efficient anonymous booking queries
bookingSchema.index({ 'pickupLocation': '2dsphere' });
bookingSchema.index({ 'dropLocation': '2dsphere' });

// ── Pre-save: keep isAnonymous in sync with type ──────────────────────────────
bookingSchema.pre('save', function (next) {
  this.isAnonymous = this.type === 'anonymous';
  next();
});

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;

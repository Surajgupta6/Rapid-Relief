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
 *
 * Every status transition is recorded as an immutable entry in `statusHistory`
 * (see Phase 4).  This gives a full audit trail without a separate collection.
 */

// ── Status-history entry ───────────────────────────────────────────────────────
// Each entry is appended when the booking's status changes.  Entries are never
// deleted or updated — they form an append-only audit log.
const statusHistorySchema = new mongoose.Schema(
  {
    // The status the booking transitioned TO.
    status: {
      type: String,
      enum: ['pending', 'accepted', 'inProgress', 'completed', 'cancelled'],
      required: true
    },
    // Who triggered the transition (userId or driverId).
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'statusHistory.changedByModel'
    },
    changedByModel: {
      type: String,
      enum: ['User', 'Driver'],
      default: 'User'
    },
    // Optional machine-readable reason (e.g. 'driver_accepted', 'admin_force_cancel').
    reason: {
      type: String,
      trim: true
    },
    // Wall-clock time of the transition.
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

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

    // ── Idempotency (anonymous requests) ──────────────────────────────────
    // Optional client-supplied key (UUID) used to deduplicate retries within
    // a 5-minute window.  Only meaningful for anonymous bookings.
    idempotencyKey: {
      type: String,
      default: null
    },

    // ── Smart Dispatch Scoring (Phase 8) ─────────────────────────────────
    // suggestedDriver: the highest-scoring driver at booking creation time.
    // This is a recommendation, not a reservation — any verified driver can
    // still accept via the normal flow.  Stored for analysis and display.
    suggestedDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null
    },
    // dispatchScores: snapshot of the full ranking at booking creation time.
    // Each entry records the driver's score and the factors that produced it.
    // Useful for: debugging dispatch, A/B testing weight changes, training
    // a future ML model on historical dispatch outcomes.
    dispatchScores: [
      {
        driverId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
        totalScore:  Number,
        distanceKm:  Number,
        vehicleType: String,
        factors: {
          proximity:       Number,
          rating:          Number,
          acceptanceRate:  Number,
          locationRecency: Number,
          vehicleType:     Number
        },
        _id: false // no subdoc IDs needed — this is a point-in-time snapshot
      }
    ],

    // ── Decline tracking ──────────────────────────────────────────────────
    // Drivers who have declined this booking.  The booking remains 'pending'
    // so other drivers can still claim it.
    declinedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Driver'
      }
    ],

    // ── Audit trail ───────────────────────────────────────────────────────
    // Immutable, append-only log of every status change.
    // The initial 'pending' entry is written by the pre-save hook below.
    // Never delete or update entries in this array.
    statusHistory: [statusHistorySchema]
  },
  {
    // Adds createdAt and updatedAt automatically; updatedAt refreshes on
    // every save so we always know when the booking was last modified.
    timestamps: true
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ driver: 1, createdAt: -1 });
bookingSchema.index({ type: 1, status: 1 });           // Efficient anonymous booking queries
bookingSchema.index({ 'pickupLocation': '2dsphere' });
bookingSchema.index({ 'dropLocation': '2dsphere' });
// Sparse unique index: ensures no two anonymous requests share the same
// idempotency key, while allowing unlimited null values.
bookingSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
// Stale-booking queries: find old pending bookings quickly.
bookingSchema.index({ status: 1, updatedAt: 1 });

// ── Pre-save hooks ─────────────────────────────────────────────────────────────

// 1. Keep isAnonymous in sync with type.
bookingSchema.pre('save', function (next) {
  this.isAnonymous = this.type === 'anonymous';
  next();
});

// 2. Append a statusHistory entry whenever status changes.
//    On document creation (isNew) the initial 'pending' entry is written here.
bookingSchema.pre('save', function (next) {
  if (this.isNew || this.isModified('status')) {
    // _changedBy and _changedByModel are transient fields set by controllers
    // before calling save() so the audit entry knows who caused the change.
    this.statusHistory.push({
      status: this.status,
      changedBy: this._changedBy || null,
      changedByModel: this._changedByModel || 'User',
      reason: this._changeReason || null,
      timestamp: new Date()
    });
  }
  next();
});

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;

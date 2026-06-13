const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const hospitalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Hospital name is required'],
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
    address: {
      type: String,
      required: [true, 'Address is required']
    },
    licenseNumber: {
      type: String,
      required: [true, 'License number is required'],
      unique: true
    },
    generalWard: {
      capacity: {
        type: Number,
        required: [true, 'General ward capacity is required'],
        min: 0
      },
      availableBeds: {
        type: Number,
        required: [true, 'Available beds in general ward is required'],
        min: 0
      }
    },
    opd: {
      capacity: {
        type: Number,
        required: [true, 'OPD capacity is required'],
        min: 0
      },
      availableBeds: {
        type: Number,
        required: [true, 'Available beds in OPD is required'],
        min: 0
      }
    },
    emergencyDepartment: {
      capacity: {
        type: Number,
        required: [true, 'Emergency department capacity is required'],
        min: 0
      },
      availableBeds: {
        type: Number,
        required: [true, 'Available beds in emergency department is required'],
        min: 0
      }
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
    isVerified: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// Create geospatial index for location-based queries
hospitalSchema.index({ location: '2dsphere' });

// Hash the password before saving
hospitalSchema.pre('save', async function(next) {
  // Only run this function if password was modified
  if (!this.isModified('password')) return next();

  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Method to check if entered password is correct
hospitalSchema.methods.correctPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const Hospital = mongoose.model('Hospital', hospitalSchema);

module.exports = Hospital; 
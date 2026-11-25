/**
 * Centralised input-validation rules (express-validator).
 *
 * Each export is an array that can be spread directly into a route:
 *   router.post('/booking', ...createBookingRules, handleValidationErrors, controller)
 *
 * handleValidationErrors must always be the LAST element before the controller
 * so it collects every field error in one pass.
 */
const { body, validationResult } = require('express-validator');

// ─── Error aggregator ─────────────────────────────────────────────────────────
/**
 * Reads collected validation errors and returns a 400 with a structured body.
 * Place at the end of a validation chain, before the controller handler.
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

// ─── Coordinate helper ────────────────────────────────────────────────────────
const validCoordinates = (fieldPath) =>
  body(fieldPath)
    .isArray({ min: 2, max: 2 })
    .withMessage(`${fieldPath} must be [longitude, latitude]`)
    .bail()
    .custom((coords) => {
      const [lng, lat] = coords;
      if (typeof lng !== 'number' || typeof lat !== 'number') {
        throw new Error('Coordinates must be numeric');
      }
      if (lng < -180 || lng > 180) throw new Error('Longitude must be between -180 and 180');
      if (lat < -90 || lat > 90) throw new Error('Latitude must be between -90 and 90');
      return true;
    });

// ─── Auth rules ───────────────────────────────────────────────────────────────
const registerRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('A valid email address is required'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone number is required'),
  body('address')
    .trim()
    .notEmpty().withMessage('Address is required')
];

const loginRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('A valid email address is required'),
  body('password')
    .notEmpty().withMessage('Password is required')
];

const registerDriverRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('A valid email address is required'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone number is required'),
  body('licenseNumber')
    .trim()
    .notEmpty().withMessage('License number is required')
];

// ─── Booking rules ────────────────────────────────────────────────────────────
const createBookingRules = [
  body('patientName')
    .trim()
    .notEmpty().withMessage('Patient name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Patient name must be 2–100 characters'),
  body('patientContact')
    .trim()
    .notEmpty().withMessage('Patient contact number is required'),
  body('medicalCondition')
    .trim()
    .notEmpty().withMessage('Medical condition description is required')
    .isLength({ min: 2, max: 500 }).withMessage('Medical condition must be 2–500 characters'),
  body('pickupLocation')
    .notEmpty().withMessage('Pickup location is required'),
  body('pickupLocation.coordinates')
    .isArray({ min: 2, max: 2 }).withMessage('Pickup coordinates must be [longitude, latitude]')
    .bail()
    .custom((coords) => {
      const [lng, lat] = coords;
      if (typeof lng !== 'number' || typeof lat !== 'number') throw new Error('Coordinates must be numeric');
      if (lng < -180 || lng > 180) throw new Error('Longitude must be between -180 and 180');
      if (lat < -90 || lat > 90) throw new Error('Latitude must be between -90 and 90');
      return true;
    })
];

const anonymousBookingRules = [
  validCoordinates('coordinates')
];

module.exports = {
  handleValidationErrors,
  registerRules,
  loginRules,
  registerDriverRules,
  createBookingRules,
  anonymousBookingRules
};

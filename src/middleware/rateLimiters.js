/**
 * Shared rate-limiter instances.
 *
 * Centralised here so the same configuration is reused across the auth
 * router, the hospital router, and any other router that needs them.
 */
const rateLimit = require('express-rate-limit');

/**
 * Applied to every authentication endpoint (login, register).
 * 10 failed attempts per 15-minute window; successful requests are not
 * counted so legitimate users are not throttled.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    status: 'error',
    message: 'Too many requests from this IP. Please try again in 15 minutes.'
  }
});

/**
 * Applied to the unauthenticated anonymous emergency-booking endpoint.
 * Tighter window to prevent flooding the driver notification queue.
 */
const anonymousBookingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many emergency requests. If this is a real emergency, call 112 directly.'
  }
});

module.exports = { authLimiter, anonymousBookingLimiter };


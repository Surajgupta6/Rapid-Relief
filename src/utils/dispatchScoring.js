'use strict';

/**
 * Smart Dispatch Scoring — Phase 8 (AI/ML layer)
 *
 * Scores every available verified driver for a given booking using a
 * multi-factor weighted model.  The score determines dispatch priority:
 * the highest-scoring driver is set as `suggestedDriver` on the booking
 * and receives the alert first; the remaining drivers are notified ranked
 * by score.
 *
 * ── Scoring factors ──────────────────────────────────────────────────────────
 *
 *  Factor                Weight   Rationale
 *  ─────────────────────────────────────────────────────────────────────────
 *  Proximity             0.40     Closest driver = fastest response time
 *  Driver rating         0.25     Quality signal from past passengers
 *  Acceptance rate       0.20     Reliability — do they actually take jobs?
 *  Recency of location   0.10     Stale GPS = ETA estimate is unreliable
 *  Vehicle type match    0.05     ALS/Critical Care preferred for emergencies
 *
 * ── Design decisions ─────────────────────────────────────────────────────────
 *
 *  • Weights are hand-tuned constants today.  With ≥500 completed trips the
 *    weights can be learned via Ridge regression on outcome data
 *    (actual arrival time, patient rating).  Exporting coefficients as JSON
 *    lets Node.js run inference with no Python server.
 *
 *  • All factor values are normalised to [0, 1] before weighting so that
 *    no single factor dominates due to scale differences.
 *
 *  • Pure functions with no I/O side-effects → easy to unit test.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Scoring weights — must sum to 1.0 */
const WEIGHTS = {
  proximity:      0.40,
  rating:         0.25,
  acceptanceRate: 0.20,
  locationRecency: 0.10,
  vehicleType:    0.05
};

/**
 * Vehicle type priority for emergency bookings.
 * Higher = more capable = preferred for severe conditions.
 */
const VEHICLE_PRIORITY = {
  'Critical Care': 1.0,
  'Advanced':      0.7,
  'Basic':         0.4
};

/** Haversine distance in km between two [lng, lat] coordinate pairs. */
function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Individual factor scorers ─────────────────────────────────────────────────
// Each function returns a value in [0, 1].

/**
 * Proximity score — inverse distance, capped at MAX_KM.
 * A driver 0 km away scores 1.0; at MAX_KM they score 0.0.
 */
function proximityScore(driverCoords, pickupCoords, maxKm = 50) {
  if (!driverCoords || driverCoords[0] === 0 && driverCoords[1] === 0) return 0;
  const dist = haversineKm(driverCoords, pickupCoords);
  return Math.max(0, 1 - dist / maxKm);
}

/**
 * Rating score — normalise 0–5 star rating to 0–1.
 * New drivers with 0 ratings receive a neutral 0.5 to avoid penalising them.
 */
function ratingScore(rating, totalRatings) {
  if (!totalRatings || totalRatings === 0) return 0.5; // prior: neutral
  return Math.min(rating, 5) / 5;
}

/**
 * Acceptance rate score — ratio of accepted to total offered bookings.
 * Falls back to neutral 0.5 for drivers with no history.
 */
function acceptanceRateScore(acceptedCount, declinedCount) {
  const total = (acceptedCount || 0) + (declinedCount || 0);
  if (total === 0) return 0.5; // prior: neutral
  return (acceptedCount || 0) / total;
}

/**
 * Location recency score — how fresh is the driver's GPS reading?
 * Updated in the last 5 min → 1.0; older than MAX_STALE_MIN → 0.0.
 */
function locationRecencyScore(locationSetAt, maxStaleMinutes = 30) {
  if (!locationSetAt) return 0;
  const ageMs = Date.now() - new Date(locationSetAt).getTime();
  const ageMin = ageMs / 60000;
  return Math.max(0, 1 - ageMin / maxStaleMinutes);
}

/**
 * Vehicle type score — based on VEHICLE_PRIORITY lookup table.
 * Unknown types default to 0.4 (Basic equivalent).
 */
function vehicleTypeScore(vehicleType) {
  return VEHICLE_PRIORITY[vehicleType] ?? 0.4;
}

// ── Main scoring function ─────────────────────────────────────────────────────

/**
 * scoreDriver(driver, pickupCoords) → DispatchScore
 *
 * @param {object} driver          - Mongoose Driver document (plain object ok)
 * @param {number[]} pickupCoords  - [longitude, latitude] of pickup point
 * @returns {DispatchScore}
 *
 * @typedef {object} DispatchScore
 * @property {string}  driverId        - Driver ObjectId (string)
 * @property {number}  totalScore      - Final weighted score [0, 1]
 * @property {object}  factors         - Individual normalised factor scores
 * @property {number}  distanceKm      - Raw distance in km (for display)
 * @property {string}  vehicleType     - Driver's vehicle type
 */
function scoreDriver(driver, pickupCoords) {
  const driverCoords = driver.location?.coordinates;
  const distanceKm = (driverCoords && !(driverCoords[0] === 0 && driverCoords[1] === 0))
    ? Math.round(haversineKm(driverCoords, pickupCoords) * 10) / 10
    : null;

  const factors = {
    proximity:       proximityScore(driverCoords, pickupCoords),
    rating:          ratingScore(driver.rating, driver.totalRatings),
    acceptanceRate:  acceptanceRateScore(driver.acceptedCount, driver.declinedCount),
    locationRecency: locationRecencyScore(driver.locationSetAt),
    vehicleType:     vehicleTypeScore(driver.vehicleType)
  };

  const totalScore =
    factors.proximity       * WEIGHTS.proximity +
    factors.rating          * WEIGHTS.rating +
    factors.acceptanceRate  * WEIGHTS.acceptanceRate +
    factors.locationRecency * WEIGHTS.locationRecency +
    factors.vehicleType     * WEIGHTS.vehicleType;

  return {
    driverId:   driver._id.toString(),
    totalScore: Math.round(totalScore * 1000) / 1000, // 3 decimal places
    factors,
    distanceKm,
    vehicleType: driver.vehicleType
  };
}

/**
 * rankDrivers(drivers, pickupCoords) → DispatchScore[]
 *
 * Scores all drivers and returns them sorted by totalScore descending.
 * The first element is the recommended (highest-scoring) driver.
 *
 * @param {object[]} drivers       - Array of Driver documents
 * @param {number[]} pickupCoords  - [longitude, latitude]
 * @returns {DispatchScore[]}
 */
function rankDrivers(drivers, pickupCoords) {
  return drivers
    .map((d) => scoreDriver(d, pickupCoords))
    .sort((a, b) => b.totalScore - a.totalScore);
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  rankDrivers,
  scoreDriver,
  // Export individual scorers for unit testing
  _internals: {
    haversineKm,
    proximityScore,
    ratingScore,
    acceptanceRateScore,
    locationRecencyScore,
    vehicleTypeScore,
    WEIGHTS,
    VEHICLE_PRIORITY
  }
};

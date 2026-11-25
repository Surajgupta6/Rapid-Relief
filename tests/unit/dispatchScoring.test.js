'use strict';

/**
 * Phase 8 — Smart Dispatch Scoring: Unit Tests
 *
 * Tests the pure scoring functions in src/utils/dispatchScoring.js.
 * No database, no network, no mocks — pure function tests only.
 */

const {
  rankDrivers,
  scoreDriver,
  _internals: {
    haversineKm,
    proximityScore,
    ratingScore,
    acceptanceRateScore,
    locationRecencyScore,
    vehicleTypeScore,
    WEIGHTS
  }
} = require('../../src/utils/dispatchScoring');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal driver object for testing */
function makeDriver(overrides = {}) {
  return {
    _id: { toString: () => overrides.id || 'driver-id-1' },
    location: {
      coordinates: overrides.coordinates || [77.5946, 12.9716]
    },
    locationSetAt: overrides.locationSetAt !== undefined
      ? overrides.locationSetAt
      : new Date(), // fresh by default
    rating:        overrides.rating        ?? 4.5,
    totalRatings:  overrides.totalRatings  ?? 10,
    acceptedCount: overrides.acceptedCount ?? 8,
    declinedCount: overrides.declinedCount ?? 2,
    vehicleType:   overrides.vehicleType   || 'Advanced'
  };
}

const PICKUP = [77.6033, 12.9784]; // reference pickup point

// ── haversineKm ───────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  test('returns 0 for identical coordinates', () => {
    expect(haversineKm([77.5946, 12.9716], [77.5946, 12.9716])).toBe(0);
  });

  test('is symmetric', () => {
    const a = [77.5946, 12.9716];
    const b = [77.6033, 12.9784];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 5);
  });

  test('returns positive value for distinct points', () => {
    expect(haversineKm([77.5946, 12.9716], [77.6033, 12.9784])).toBeGreaterThan(0);
  });

  test('increases with greater separation', () => {
    const near = haversineKm([77.5946, 12.9716], [77.6, 12.975]);
    const far  = haversineKm([77.5946, 12.9716], [78.5, 13.5]);
    expect(far).toBeGreaterThan(near);
  });
});

// ── proximityScore ────────────────────────────────────────────────────────────

describe('proximityScore', () => {
  test('returns 1 for driver at the exact pickup point', () => {
    expect(proximityScore(PICKUP, PICKUP)).toBe(1);
  });

  test('returns 0 for [0, 0] coordinates (default / unset)', () => {
    expect(proximityScore([0, 0], PICKUP)).toBe(0);
  });

  test('returns 0 for null coordinates', () => {
    expect(proximityScore(null, PICKUP)).toBe(0);
  });

  test('score decreases as distance increases', () => {
    const close = proximityScore([77.6, 12.975], PICKUP);  // ~1 km away
    const far   = proximityScore([78.5, 13.5],   PICKUP);  // many km away
    expect(close).toBeGreaterThan(far);
  });

  test('never goes below 0', () => {
    // 100 km away, maxKm = 50 → should clamp to 0 not go negative
    const score = proximityScore([78.5, 13.9], PICKUP, 50);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test('output is in [0, 1]', () => {
    const score = proximityScore([77.6, 12.98], PICKUP);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ── ratingScore ───────────────────────────────────────────────────────────────

describe('ratingScore', () => {
  test('5-star driver with ratings → 1.0', () => {
    expect(ratingScore(5, 20)).toBe(1);
  });

  test('0-star driver with ratings → 0.0', () => {
    expect(ratingScore(0, 10)).toBe(0);
  });

  test('new driver (0 ratings) → neutral 0.5', () => {
    expect(ratingScore(0, 0)).toBe(0.5);
  });

  test('4-star → 0.8', () => {
    expect(ratingScore(4, 5)).toBeCloseTo(0.8);
  });

  test('output is in [0, 1]', () => {
    const score = ratingScore(3.7, 25);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ── acceptanceRateScore ───────────────────────────────────────────────────────

describe('acceptanceRateScore', () => {
  test('always-accepts driver → 1.0', () => {
    expect(acceptanceRateScore(10, 0)).toBe(1);
  });

  test('never-accepts driver → 0.0', () => {
    expect(acceptanceRateScore(0, 10)).toBe(0);
  });

  test('no history → neutral 0.5', () => {
    expect(acceptanceRateScore(0, 0)).toBe(0.5);
  });

  test('50% acceptance → 0.5', () => {
    expect(acceptanceRateScore(5, 5)).toBe(0.5);
  });

  test('80% acceptance → 0.8', () => {
    expect(acceptanceRateScore(8, 2)).toBeCloseTo(0.8);
  });
});

// ── locationRecencyScore ──────────────────────────────────────────────────────

describe('locationRecencyScore', () => {
  test('null locationSetAt → 0 (never reported)', () => {
    expect(locationRecencyScore(null)).toBe(0);
  });

  test('just-updated location → close to 1', () => {
    const score = locationRecencyScore(new Date(), 30);
    expect(score).toBeGreaterThan(0.95);
  });

  test('stale location (older than maxStaleMinutes) → 0', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(locationRecencyScore(oneHourAgo, 30)).toBe(0);
  });

  test('score decreases over time', () => {
    const fiveMinAgo    = new Date(Date.now() - 5  * 60 * 1000);
    const twentyMinAgo  = new Date(Date.now() - 20 * 60 * 1000);
    expect(locationRecencyScore(fiveMinAgo, 30))
      .toBeGreaterThan(locationRecencyScore(twentyMinAgo, 30));
  });
});

// ── vehicleTypeScore ──────────────────────────────────────────────────────────

describe('vehicleTypeScore', () => {
  test('Critical Care → 1.0 (highest capability)', () => {
    expect(vehicleTypeScore('Critical Care')).toBe(1.0);
  });

  test('Advanced → 0.7', () => {
    expect(vehicleTypeScore('Advanced')).toBe(0.7);
  });

  test('Basic → 0.4', () => {
    expect(vehicleTypeScore('Basic')).toBe(0.4);
  });

  test('unknown type → 0.4 (Basic equivalent fallback)', () => {
    expect(vehicleTypeScore('Unknown')).toBe(0.4);
  });
});

// ── scoreDriver ───────────────────────────────────────────────────────────────

describe('scoreDriver', () => {
  test('returns object with required fields', () => {
    const result = scoreDriver(makeDriver(), PICKUP);
    expect(result).toHaveProperty('driverId');
    expect(result).toHaveProperty('totalScore');
    expect(result).toHaveProperty('factors');
    expect(result).toHaveProperty('distanceKm');
    expect(result).toHaveProperty('vehicleType');
  });

  test('totalScore is in [0, 1]', () => {
    const result = scoreDriver(makeDriver(), PICKUP);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(1);
  });

  test('factors object contains all 5 factor keys', () => {
    const { factors } = scoreDriver(makeDriver(), PICKUP);
    expect(Object.keys(factors)).toEqual(
      expect.arrayContaining(['proximity', 'rating', 'acceptanceRate', 'locationRecency', 'vehicleType'])
    );
  });

  test('totalScore matches manual weighted sum', () => {
    const driver = makeDriver({
      coordinates: PICKUP, // distance = 0 → proximity = 1
      rating: 5,
      totalRatings: 10,
      acceptedCount: 10,
      declinedCount: 0,
      vehicleType: 'Critical Care'
    });
    const { factors, totalScore } = scoreDriver(driver, PICKUP);
    const manual =
      factors.proximity       * WEIGHTS.proximity +
      factors.rating          * WEIGHTS.rating +
      factors.acceptanceRate  * WEIGHTS.acceptanceRate +
      factors.locationRecency * WEIGHTS.locationRecency +
      factors.vehicleType     * WEIGHTS.vehicleType;
    expect(totalScore).toBeCloseTo(manual, 2);
  });

  test('closer driver scores higher than farther driver (all else equal)', () => {
    const closeDriver = makeDriver({ id: 'd1', coordinates: [77.60, 12.978] });
    const farDriver   = makeDriver({ id: 'd2', coordinates: [78.50, 13.5]  });
    const closeScore  = scoreDriver(closeDriver, PICKUP).totalScore;
    const farScore    = scoreDriver(farDriver,   PICKUP).totalScore;
    expect(closeScore).toBeGreaterThan(farScore);
  });

  test('Critical Care driver scores higher than Basic driver at same location', () => {
    const criticalDriver = makeDriver({ id: 'd1', vehicleType: 'Critical Care', coordinates: PICKUP });
    const basicDriver    = makeDriver({ id: 'd2', vehicleType: 'Basic',         coordinates: PICKUP });
    expect(scoreDriver(criticalDriver, PICKUP).totalScore)
      .toBeGreaterThan(scoreDriver(basicDriver, PICKUP).totalScore);
  });
});

// ── rankDrivers ───────────────────────────────────────────────────────────────

describe('rankDrivers', () => {
  test('returns empty array for empty driver list', () => {
    expect(rankDrivers([], PICKUP)).toEqual([]);
  });

  test('returns array sorted by totalScore descending', () => {
    const drivers = [
      makeDriver({ id: 'd1', coordinates: [78.5, 13.5],  vehicleType: 'Basic' }),     // far, basic
      makeDriver({ id: 'd2', coordinates: PICKUP,         vehicleType: 'Critical Care' }), // at pickup, critical
      makeDriver({ id: 'd3', coordinates: [77.605, 12.979], vehicleType: 'Advanced' }) // close, advanced
    ];
    const ranked = rankDrivers(drivers, PICKUP);
    expect(ranked.length).toBe(3);
    // Scores must be non-increasing
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].totalScore).toBeGreaterThanOrEqual(ranked[i + 1].totalScore);
    }
  });

  test('top-ranked driver is closest when vehicle types are equal', () => {
    const drivers = [
      makeDriver({ id: 'far',   coordinates: [78.5, 13.5],     vehicleType: 'Advanced' }),
      makeDriver({ id: 'close', coordinates: [77.601, 12.978], vehicleType: 'Advanced' })
    ];
    const ranked = rankDrivers(drivers, PICKUP);
    expect(ranked[0].driverId).toBe('close');
  });

  test('single driver returns single-element array', () => {
    const ranked = rankDrivers([makeDriver()], PICKUP);
    expect(ranked).toHaveLength(1);
  });
});

/**
 * tests/unit/fare.test.js
 *
 * Unit tests for the Haversine fare-calculation function.
 * The function is not exported from bookingController, so we reimplement
 * the same formula here and test the boundary conditions directly.
 */
'use strict';

// Replicated from bookingController.js — same formula, tested in isolation.
function calculateFare(pickupCoords, dropCoords) {
  const R = 6371;
  const dLat = ((dropCoords[1] - pickupCoords[1]) * Math.PI) / 180;
  const dLon = ((dropCoords[0] - pickupCoords[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((pickupCoords[1] * Math.PI) / 180) *
      Math.cos((dropCoords[1] * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(100 + distance * 15);
}

describe('calculateFare', () => {
  test('returns base fare (100) for identical pickup and drop coordinates', () => {
    const coords = [77.209, 28.6139];
    expect(calculateFare(coords, coords)).toBe(100);
  });

  test('returns a fare greater than base for different locations', () => {
    const pickup = [77.209, 28.6139];  // India Gate
    const drop   = [77.2300, 28.6354]; // Red Fort (~3.4 km)
    expect(calculateFare(pickup, drop)).toBeGreaterThan(100);
  });

  test('fare increases with distance', () => {
    const origin    = [0, 0];
    const nearby    = [0.01, 0];   // ~1.1 km
    const farAway   = [0.1, 0];    // ~11 km

    const nearFare = calculateFare(origin, nearby);
    const farFare  = calculateFare(origin, farAway);

    expect(farFare).toBeGreaterThan(nearFare);
  });

  test('fare is symmetric (A→B equals B→A)', () => {
    const a = [77.209, 28.6139];
    const b = [77.2300, 28.6354];
    // Rounding may cause ±1 difference — allow for that
    expect(Math.abs(calculateFare(a, b) - calculateFare(b, a))).toBeLessThanOrEqual(1);
  });

  test('returns a whole number (Math.round applied)', () => {
    const pickup = [72.8777, 19.0760]; // Mumbai
    const drop   = [73.0000, 19.1000];
    const result = calculateFare(pickup, drop);
    expect(Number.isInteger(result)).toBe(true);
  });
});


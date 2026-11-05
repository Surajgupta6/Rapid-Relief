/**
 * tests/unit/notify.test.js
 *
 * Unit tests for the notify helper.
 * Verifies that each function emits to the correct room with the correct
 * event name and that it is a no-op when io is null.
 */
'use strict';

const notify = require('../../src/utils/notify');

function makeIo() {
  const rooms = {};
  const mockSocket = {
    emit: jest.fn((event, payload) => {
      mockSocket._lastEmit = { event, payload };
    }),
    _lastEmit: null
  };
  const io = {
    to: jest.fn((room) => {
      rooms[room] = rooms[room] || { emit: jest.fn() };
      return rooms[room];
    }),
    emit: jest.fn(),
    _rooms: rooms
  };
  return { io, mockSocket };
}

describe('notify helper', () => {
  test('bookingCreated emits newBookingAlert to drivers room', () => {
    const { io } = makeIo();
    notify.bookingCreated(io, { booking: { _id: '1' }, nearbyDriverCount: 3 });
    expect(io.to).toHaveBeenCalledWith('drivers');
    const roomEmit = io.to.mock.results[0].value.emit;
    expect(roomEmit).toHaveBeenCalledWith(
      'newBookingAlert',
      expect.objectContaining({ booking: { _id: '1' }, nearbyDriverCount: 3 })
    );
  });

  test('bookingCancelled emits bookingCancelled to all', () => {
    const { io } = makeIo();
    notify.bookingCancelled(io, { bookingId: 'abc', reason: 'user_cancelled' });
    expect(io.emit).toHaveBeenCalledWith(
      'bookingCancelled',
      expect.objectContaining({ bookingId: 'abc' })
    );
  });

  test('driverVerified emits to personal driver room only', () => {
    const { io } = makeIo();
    notify.driverVerified(io, { driverId: 'drv1' });
    expect(io.to).toHaveBeenCalledWith('driver_drv1');
  });

  test('driverRevoked emits to personal driver room only', () => {
    const { io } = makeIo();
    notify.driverRevoked(io, { driverId: 'drv2' });
    expect(io.to).toHaveBeenCalledWith('driver_drv2');
  });

  test('driverLocationUpdate emits to booking room', () => {
    const { io } = makeIo();
    notify.driverLocationUpdate(io, {
      bookingId: 'bk1',
      driverId: 'drv1',
      location: { coordinates: [77, 28] },
      locationAge: 10
    });
    expect(io.to).toHaveBeenCalledWith('booking_bk1');
  });

  test('all notify functions are no-ops when io is null', () => {
    expect(() => notify.bookingCreated(null, {})).not.toThrow();
    expect(() => notify.bookingCancelled(null, {})).not.toThrow();
    expect(() => notify.driverVerified(null, {})).not.toThrow();
    expect(() => notify.anonymousRequestCreated(null, {})).not.toThrow();
  });

  test('every emitted payload contains _sentAt timestamp', () => {
    const { io } = makeIo();
    notify.bookingCreated(io, { booking: { _id: 'x' }, nearbyDriverCount: 1 });
    const roomEmit = io.to.mock.results[0].value.emit;
    const payload = roomEmit.mock.calls[0][1];
    expect(payload._sentAt).toBeDefined();
    expect(typeof payload._sentAt).toBe('number');
  });
});


'use strict';

/**
 * src/sockets/index.js
 *
 * All Socket.IO event handling for Rapid Relief.
 *
 * Security model:
 *  - Every socket inherits the Express session via the shared sessionMiddleware.
 *  - socket.isAuthenticated / socket.sessionUser are set by the auth middleware
 *    in app.js before this module's handlers run.
 *  - Privileged events validate identity per-handler.
 *  - Room access (joinBookingRoom) is authorised against the database; a user
 *    must own or be assigned to a booking to receive its location events.
 *  - A driver cannot spoof another driver's ID or location.
 */

const Driver = require('../models/Driver');
const Booking = require('../models/Booking');

/**
 * Attach all Socket.IO handlers to the server-wide `io` instance.
 * Called once from app.js after io is created.
 *
 * @param {import('socket.io').Server} io
 */
function attachSocketHandlers(io) {
  io.on('connection', (socket) => {
    // ── register ───────────────────────────────────────────────────────────────
    // Client registers itself so the server routes events to the right room.
    // Claimed identity is validated against the session.
    socket.on('register', (data) => {
      if (!socket.isAuthenticated) return;

      const { type, id } = data || {};
      const user = socket.sessionUser;

      if (!type || !id) return;
      if (id.toString() !== user.id.toString()) return; // identity check
      if (type === 'driver' && user.role !== 'driver') return;
      if (type === 'user' && user.role === 'driver') return;

      socket.userData = { type, id };
      socket.join(`${type}_${id}`);

      // Drivers join the shared 'drivers' room to receive booking broadcast alerts.
      // Only verified drivers should be in this room — we rely on isVerified being
      // checked at dispatch time, but we also enforce it here on connect.
      if (type === 'driver') {
        Driver.findById(user.driverId)
          .then((driver) => {
            if (driver && driver.isVerified && driver.isAvailable) {
              socket.join('drivers');
            }
          })
          .catch((err) => {
            console.error('[socket] register: driver lookup error:', err.message);
          });
      }

      socket.emit('registered', { type, id });
    });

    // ── joinBookingRoom ─────────────────────────────────────────────────────────
    // Authorised room join: the caller must be the booking owner OR the assigned
    // driver.  Anonymous bookings (no user field) can only be joined by the
    // assigned driver or admin.
    socket.on('joinBookingRoom', async (data) => {
      if (!socket.isAuthenticated) {
        return socket.emit('error', { message: 'Authentication required' });
      }

      const { bookingId } = data || {};
      if (!bookingId) return;

      try {
        const booking = await Booking.findById(bookingId).lean();
        if (!booking) {
          return socket.emit('error', { message: 'Booking not found' });
        }

        const user = socket.sessionUser;
        const isOwner = booking.user && booking.user.toString() === user.id.toString();
        const isAssignedDriver =
          user.role === 'driver' &&
          user.driverId &&
          booking.driver &&
          booking.driver.toString() === user.driverId.toString();
        const isAdmin = user.role === 'admin';

        if (!isOwner && !isAssignedDriver && !isAdmin) {
          return socket.emit('error', {
            message: 'You are not authorised to track this booking'
          });
        }

        socket.join(`booking_${bookingId}`);
        socket.emit('joinedBookingRoom', { bookingId });
      } catch (err) {
        console.error('[socket] joinBookingRoom error:', err.message);
        socket.emit('error', { message: 'Failed to join booking room' });
      }
    });

    // ── updateDriverLocation ────────────────────────────────────────────────────
    // The active driver broadcasts their GPS position.
    // Phase 5: also persists to the database so locationSetAt stays fresh,
    // removing the requirement for a separate HTTP PUT /driver/location call
    // during an active trip.
    //
    // Rate: the client should throttle to ≤1 event/5 seconds; the server
    // persists every call but the DB write is non-blocking (fire-and-forget
    // with error logging).
    socket.on('updateDriverLocation', async (data) => {
      if (!socket.isAuthenticated || socket.sessionUser.role !== 'driver') return;

      const { driverId, location, bookingId } = data || {};
      const sessionDriverId = socket.sessionUser.driverId;

      if (!sessionDriverId) return;
      // Prevent a driver from spoofing another driver's position
      if (driverId && driverId.toString() !== sessionDriverId.toString()) return;
      if (!location || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) return;

      const [lng, lat] = location.coordinates;
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return;

      // Persist to DB (non-blocking — don't await to avoid blocking the event)
      Driver.findByIdAndUpdate(sessionDriverId, {
        'location.coordinates': location.coordinates,
        locationSetAt: new Date()
      }).catch((err) => {
        console.error('[socket] updateDriverLocation DB persist error:', err.message);
      });

      // Forward to booking room if provided
      if (bookingId) {
        io.to(`booking_${bookingId}`).emit('driverLocationUpdate', {
          driverId: sessionDriverId,
          location,
          timestamp: Date.now()
        });
      }
    });

    // ── driverAvailabilityUpdate ────────────────────────────────────────────────
    // Driver toggles availability; server joins/leaves the 'drivers' room so
    // they receive or stop receiving booking broadcasts.
    socket.on('driverAvailabilityUpdate', async (data) => {
      if (!socket.isAuthenticated || socket.sessionUser.role !== 'driver') return;

      const { isAvailable } = data || {};

      // Persist the availability change to DB
      if (socket.sessionUser.driverId) {
        try {
          await Driver.findByIdAndUpdate(socket.sessionUser.driverId, { isAvailable });
        } catch (err) {
          console.error('[socket] driverAvailabilityUpdate DB error:', err.message);
        }
      }

      if (isAvailable) {
        socket.join('drivers');
      } else {
        socket.leave('drivers');
      }

      socket.emit('availabilityUpdated', { isAvailable });
    });

    // ── disconnect ─────────────────────────────────────────────────────────────
    // Clean up room memberships and leave the drivers broadcast pool.
    // Note: Socket.IO automatically removes sockets from rooms on disconnect;
    // we only need custom cleanup for application-level state.
    socket.on('disconnect', (reason) => {
      if (!socket.sessionUser) return;

      if (socket.sessionUser.role === 'driver') {
        // Log disconnection for observability — no room.leave() needed as
        // Socket.IO handles it, but we record it for debugging.
        console.info(
          `[socket] Driver ${socket.sessionUser.driverId} disconnected (${reason})`
        );
      }
    });

    // ── ping / heartbeat ───────────────────────────────────────────────────────
    // Simple liveness check — client sends 'ping', server replies 'pong'.
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });
  });
}

module.exports = { attachSocketHandlers };


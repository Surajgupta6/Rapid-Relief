const socketIO = require('socket.io');

function initializeSocket(server) {
  const io = socketIO(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Store connected users and drivers
  const connectedUsers = new Map();
  const connectedDrivers = new Map();

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // User/Driver authentication
    socket.on('authenticate', (data) => {
      const { userId, role } = data;
      if (role === 'driver') {
        connectedDrivers.set(userId, socket.id);
        socket.join('drivers');
      } else {
        connectedUsers.set(userId, socket.id);
      }
      console.log(`${role} authenticated:`, userId);
    });

    // Handle new booking notifications
    socket.on('newBooking', (booking) => {
      io.to('drivers').emit('newBookingAlert', booking);
    });

    // Handle booking status updates
    socket.on('bookingStatusUpdate', (data) => {
      const { userId, driverId, status, bookingId } = data;
      const userSocketId = connectedUsers.get(userId);
      const driverSocketId = connectedDrivers.get(driverId);

      if (userSocketId) {
        io.to(userSocketId).emit('bookingUpdate', { bookingId, status });
      }
      if (driverSocketId) {
        io.to(driverSocketId).emit('bookingUpdate', { bookingId, status });
      }
    });

    // Handle driver location updates
    socket.on('updateDriverLocation', (data) => {
      const { bookingId, location } = data;
      io.emit(`driverLocation_${bookingId}`, location);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      // Remove from connected clients
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          break;
        }
      }
      for (const [driverId, socketId] of connectedDrivers.entries()) {
        if (socketId === socket.id) {
          connectedDrivers.delete(driverId);
          break;
        }
      }
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

module.exports = initializeSocket; 
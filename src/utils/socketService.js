const socketIO = require('socket.io');
const DriverStatus = require('../models/DriverStatus');

let io;

const initializeSocket = (server) => {
    io = socketIO(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('New client connected');

        // Handle driver status updates
        socket.on('driver-status-update', async (data) => {
            const { driverId, isOnline, location } = data;
            
            await DriverStatus.findOneAndUpdate(
                { driverId },
                {
                    isOnline,
                    currentLocation: {
                        type: 'Point',
                        coordinates: [location.longitude, location.latitude]
                    },
                    lastUpdated: new Date()
                },
                { upsert: true }
            );

            // Broadcast driver status to all connected clients
            io.emit('driver-status-changed', { driverId, isOnline });
        });

        // Handle booking requests
        socket.on('booking-request', (bookingData) => {
            // Find nearby available drivers
            DriverStatus.find({
                isOnline: true,
                isAvailable: true,
                currentLocation: {
                    $near: {
                        $geometry: {
                            type: "Point",
                            coordinates: [bookingData.pickupLocation.longitude, bookingData.pickupLocation.latitude]
                        },
                        $maxDistance: 10000 // 10km radius
                    }
                }
            }).then(drivers => {
                // Broadcast booking request to nearby drivers
                drivers.forEach(driver => {
                    io.to(`driver-${driver.driverId}`).emit('new-booking-request', bookingData);
                });
            });
        });

        // Handle driver accepting booking
        socket.on('accept-booking', (data) => {
            const { bookingId, driverId } = data;
            io.emit('booking-accepted', { bookingId, driverId });
        });

        // Handle location updates during active booking
        socket.on('location-update', (data) => {
            const { bookingId, location } = data;
            io.emit(`location-update-${bookingId}`, location);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected');
        });
    });

    return io;
};

module.exports = {
    initializeSocket,
    getIO: () => io
}; 
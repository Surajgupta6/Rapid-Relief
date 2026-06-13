require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const morgan = require('morgan');
const http = require('http');
const socketIO = require('socket.io');
const i18n = require('./config/i18n');
const cookieParser = require('cookie-parser');
const driverController = require('./controllers/driverController');

// Import models
const User = require('./models/User');
const Driver = require('./models/Driver');
const Booking = require('./models/Booking');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const driverRoutes = require('./routes/driver');
const bookingRoutes = require('./routes/booking');
const authMiddleware = require('./middleware/authMiddleware');
const hospitalRoutes = require('./routes/hospital');

// Initialize express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Make io accessible to routes
app.io = io;

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(morgan('dev'));
app.use(cookieParser());

// i18n middleware
app.use(i18n.init);

// Language switch route
app.get('/change-language/:lang', (req, res) => {
  const lang = req.params.lang;
  if (['en', 'hi'].includes(lang)) {
    res.cookie('lang', lang);
    req.setLocale(lang);
  }
  res.redirect('back');
});

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'sessions'
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
  })
);

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Socket.io for real-time location updates
io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Store user type and ID
  socket.on('register', (data) => {
    const { type, id } = data;
    socket.userData = { type, id };
    socket.join(`${type}_${id}`); // Join a room specific to this user
  });

  // Listen for location updates from drivers
  socket.on('updateDriverLocation', (data) => {
    const { driverId, location, bookingId } = data;
    
    // Broadcast to specific booking room
    if (bookingId) {
      io.to(`booking_${bookingId}`).emit('driverLocationUpdate', {
        driverId,
        location,
        timestamp: Date.now()
      });
    }
  });

  // Handle booking requests
  socket.on('newBooking', (bookingData) => {
    // Broadcast to all available drivers
    io.to('available_drivers').emit('newBookingRequest', bookingData);
  });

  // Handle booking acceptance
  socket.on('bookingAccepted', (data) => {
    const { bookingId, driverId, driverName, vehicleInfo } = data;
    
    // Create a booking-specific room
    socket.join(`booking_${bookingId}`);
    
    // Notify the client
    io.to(`booking_${bookingId}`).emit('bookingAccepted', {
      bookingId,
      driverId,
      driverName,
      vehicleInfo,
      timestamp: Date.now()
    });
  });

  // Handle booking status updates
  socket.on('bookingStatusUpdate', (data) => {
    const { bookingId, status, driverId, location } = data;
    
    io.to(`booking_${bookingId}`).emit('bookingStatusUpdated', {
      bookingId,
      status,
      driverId,
      location,
      timestamp: Date.now()
    });
  });

  // Handle driver availability
  socket.on('driverAvailabilityUpdate', (data) => {
    const { driverId, isAvailable } = data;
    if (isAvailable) {
      socket.join('available_drivers');
    } else {
      socket.leave('available_drivers');
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
    // Clean up if it was a driver
    if (socket.userData && socket.userData.type === 'driver') {
      socket.leave('available_drivers');
    }
  });
});

// Routes
app.use('/auth', authRoutes);
app.use('/user', authMiddleware.protect, userRoutes);
app.use('/driver/api', authMiddleware.protect, authMiddleware.restrictTo('driver'), driverRoutes);
app.use('/booking', bookingRoutes);
app.use('/hospital', hospitalRoutes);

// Driver dashboard routes
app.get('/driver/dashboard', authMiddleware.protect, authMiddleware.restrictTo('driver'), driverController.getDashboard);

app.get('/driver/bookings', authMiddleware.protect, authMiddleware.restrictTo('driver'), (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'driver' || !req.session.user.driverId) {
      console.log('Driver bookings access denied:', {
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        role: req.session?.user?.role,
        driverId: req.session?.user?.driverId
      });
      return res.redirect('/driver/login');
    }
    res.render('driver/bookings');
  } catch (error) {
    console.error('Error accessing driver bookings:', error);
    res.redirect('/driver/login');
  }
});

app.get('/driver/profile', authMiddleware.protect, authMiddleware.restrictTo('driver'), (req, res) => {
  if (req.session.user.role !== 'driver') {
    return res.redirect('/user/dashboard');
  }
  res.render('driver/profile');
});

// Home route
app.get('/', (req, res) => {
  res.render('index');
});

// Handle missing image files
app.get('/images/ambulance-hero.png', (req, res) => {
  // Create a simple text response for the missing image
  res.writeHead(200, { 'Content-Type': 'image/png' });
  res.end('Placeholder for ambulance hero image');
});

app.get('/images/ambulance-bg.jpg', (req, res) => {
  // Create a simple text response for the missing image
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  res.end('Placeholder for ambulance background image');
});

// Auth routes for pages
app.get('/register', (req, res) => {
  res.render('auth/register');
});

app.get('/login', (req, res) => {
  res.render('auth/login');
});

// Driver registration routes
app.get('/register-driver', driverController.getRegisterPage);
app.post('/driver/register', driverController.register);
app.get('/driver/login', driverController.getLoginPage);
app.post('/driver/login', driverController.login);

// Debug route for session
app.get('/debug-session', (req, res) => {
  res.json({
    session: req.session,
    user: req.session.user || null
  });
});

// Book Now route
app.get('/book-now', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login?redirect=/book-now');
  }
  res.render('user/dashboard', { bookingMode: true });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal server error'
  });
});

// Connect to MongoDB
mongoose.set('strictQuery', true);

mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => {
    console.log('Connected to MongoDB');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Application available at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...');
  console.error('Error:', err);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error('Error:', err);
  process.exit(1);
});

module.exports = app; 
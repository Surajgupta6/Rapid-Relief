require('dotenv').config();

// ─── Environment validation ───────────────────────────────────────────────────
// Fail immediately if required secrets are missing or dangerously short.
// This prevents the application from starting in a broken / insecure state.
const REQUIRED_ENV = ['MONGODB_URI', 'SESSION_SECRET'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingEnv.join(', ')}`);
  console.error('Copy .env.example to .env and fill in real values before starting.');
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error(
    'FATAL: SESSION_SECRET must be at least 32 characters long. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
  process.exit(1);
}

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const morgan = require('morgan');
const http = require('http');
const socketIO = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const i18n = require('./config/i18n');
const cookieParser = require('cookie-parser');
const driverController = require('./controllers/driverController');
const { authLimiter, anonymousBookingLimiter } = require('./middleware/rateLimiters');
const { attachSocketHandlers } = require('./sockets');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const driverRoutes = require('./routes/driver');
const bookingRoutes = require('./routes/booking');
const authMiddleware = require('./middleware/authMiddleware');
const hospitalRoutes = require('./routes/hospital');
const adminRoutes = require('./routes/admin');

const isProd = process.env.NODE_ENV === 'production';

// ─── Express + HTTP server ────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Make io accessible to route controllers via req.app.io
app.io = io;

// ─── Security headers (helmet) ────────────────────────────────────────────────
// contentSecurityPolicy is disabled here so that EJS views can load external
// CDN assets (Leaflet, Bootstrap).  A strict CSP should be added when those
// assets are self-hosted.
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// In production restrict to explicitly listed origins via CORS_ORIGIN env var
// (comma-separated).  In development all origins are permitted.
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: isProd ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
  })
);

// ─── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── General middleware ───────────────────────────────────────────────────────
// Explicit body-size limits guard against large-payload DoS.
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Use 'combined' (Apache-style) in production to avoid leaking query strings
// to console in development; keep 'dev' locally for readability.
app.use(isProd ? morgan('combined') : morgan('dev'));
app.use(cookieParser());
app.use(i18n.init);

// ─── Language switch ──────────────────────────────────────────────────────────
app.get('/change-language/:lang', (req, res) => {
  const lang = req.params.lang;
  if (['en', 'hi'].includes(lang)) {
    res.cookie('lang', lang, { httpOnly: false, sameSite: 'strict' });
    req.setLocale(lang);
  }
  res.redirect('back');
});

// ─── Session ─────────────────────────────────────────────────────────────────
// Extract the middleware into a variable so it can be shared with Socket.IO
// (see the io.use() block below).
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    httpOnly: true,               // Never accessible from client-side JS
    secure: isProd,               // HTTPS-only in production
    sameSite: 'strict'            // CSRF mitigation
  }
});

app.use(sessionMiddleware);

// Expose session user to all EJS templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ─── Socket.IO — session sharing ─────────────────────────────────────────────
// Attach the Express session to every Socket.IO request so that handlers can
// read and validate socket.request.session.user.
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Tag each socket with its authenticated identity.  Connections are NOT
// rejected here — privileged events are validated per-handler in sockets/index.js.
io.use((socket, next) => {
  const sess = socket.request.session;
  socket.isAuthenticated = !!(sess && sess.user && sess.user.id);
  if (socket.isAuthenticated) {
    socket.sessionUser = sess.user;
  }
  next();
});

// ─── Socket.IO event handlers ─────────────────────────────────────────────────
// All handlers are defined in src/sockets/index.js to keep app.js clean.
attachSocketHandlers(io);

// ─── Routes ───────────────────────────────────────────────────────────────────
// authLimiter is applied to the entire /auth prefix (login + register).
app.use('/auth', authLimiter, authRoutes);
app.use('/user', authMiddleware.protect, userRoutes);
app.use('/driver/api', authMiddleware.protect, authMiddleware.restrictTo('driver'), driverRoutes);
app.use('/booking', bookingRoutes);
app.use('/hospital', hospitalRoutes);
// Admin API — requires valid session + admin role (enforced inside the router)
app.use('/api/admin', adminRoutes);

// Driver page routes (separate from the /driver/api JSON API)
app.get(
  '/driver/dashboard',
  authMiddleware.protect,
  authMiddleware.restrictTo('driver'),
  driverController.getDashboard
);

app.get(
  '/driver/bookings',
  authMiddleware.protect,
  authMiddleware.restrictTo('driver'),
  (req, res) => {
    try {
      if (!req.session.user || req.session.user.role !== 'driver' || !req.session.user.driverId) {
        return res.redirect('/driver/login');
      }
      res.render('driver/bookings');
    } catch (error) {
      console.error('Error accessing driver bookings:', error);
      res.redirect('/driver/login');
    }
  }
);

app.get(
  '/driver/profile',
  authMiddleware.protect,
  authMiddleware.restrictTo('driver'),
  (req, res) => {
    if (req.session.user.role !== 'driver') {
      return res.redirect('/user/dashboard');
    }
    res.render('driver/profile');
  }
);

// Public page routes
app.get('/', (req, res) => res.render('index'));

// Placeholder handlers for missing static images
app.get('/images/ambulance-hero.png', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/png' });
  res.end('Placeholder for ambulance hero image');
});

app.get('/images/ambulance-bg.jpg', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  res.end('Placeholder for ambulance background image');
});

// Auth page renders
app.get('/register', (req, res) => res.render('auth/register'));
app.get('/login', (req, res) => res.render('auth/login'));

// Driver auth page routes — apply rate limiter to the POST (form submission) endpoints
app.get('/register-driver', driverController.getRegisterPage);
app.post('/driver/register', authLimiter, driverController.register);
app.get('/driver/login', driverController.getLoginPage);
app.post('/driver/login', authLimiter, driverController.login);

// Redirect to booking page; require auth
app.get('/book-now', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login?redirect=/book-now');
  }
  res.render('user/dashboard', { bookingMode: true });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// Never expose raw error internals in production responses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} — Error ${status}:`, err);
  res.status(status).json({
    status: 'error',
    message: isProd && status === 500
      ? 'Internal server error'
      : err.message || 'Internal server error'
  });
});

// ─── Database connection + server startup ─────────────────────────────────────
mongoose.set('strictQuery', true);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      if (!isProd) console.log(`Application available at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// ─── Process-level safety nets ────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION — shutting down:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — shutting down:', err);
  process.exit(1);
});

module.exports = app;

# Rapid Relief

A production-quality emergency ambulance booking and dispatch platform built with **Node.js, Express, MongoDB, and Socket.IO**. Patients book ambulances, drivers accept and dispatch in real time, hospitals manage their fleet and bed availability, and admins oversee the entire platform.

Three separate roles: **patients (users), drivers, and hospitals/admins** — each with their own login, session, and route namespace.

---

## Features

### Patients
- Register / log in, then book an ambulance by providing patient details and picking a location on a Leaflet.js map
- **Anonymous booking** — sends just GPS coordinates with no account required, useful for quick emergency requests (rate-limited: 5 requests/hour per IP)
- Track the assigned driver's live location on the map once a booking is accepted
- View booking history, cancel active bookings, and rate the driver after completion

### Drivers
- Separate registration flow — drivers are tied to a hospital and must provide licence number, vehicle type, and ambulance registration
- Dashboard shows recent bookings including pending anonymous requests
- Accept incoming requests; once accepted, broadcasts GPS position every 10 seconds via Socket.IO
- Must be **admin-verified** (`isVerified: true`) before they appear in the dispatch pool
- Status lifecycle: `pending → accepted → inProgress → completed`

### Hospitals
- Register with ward capacity details (general ward, OPD, emergency department)
- Dashboard shows associated drivers and their active bookings
- Update bed availability and view ambulance locations from linked drivers

### Admin
- Platform statistics (users, drivers, hospitals, bookings)
- Verify or revoke driver accounts
- List and force-cancel stale bookings

### Platform engineering
- **Concurrency-safe dispatch** — `findOneAndUpdate` with optimistic `__v` locking prevents double-assignment; returns `409` to the losing driver
- **Idempotency** — repeated `acceptBooking` calls for the same booking return the same booking, not a new one
- **Audit trail** — `statusHistory` subdocument on every booking records every status transition with actor and timestamp
- **Stale detection** — bookings stuck in `pending`/`accepted` for >2 hours are flagged via admin endpoint
- **Input validation** — `express-validator` rules on all mutation endpoints; 400 response with field-level error messages on failure
- **Rate limiting** — anonymous booking endpoint capped at 5/hour/IP via `express-rate-limit`
- **Fare calculation** — Haversine formula: base ₹100 + ₹15/km, computed server-side
- **Automated tests** — Jest + Supertest; 12 unit tests verified passing; integration test suite ready (requires MongoDB)
- **Real-time notifications** — Socket.IO rooms (`drivers`, `user:<id>`, `booking:<id>`, `hospital:<id>`) with a typed `notify()` helper

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js ≥18, Express 4 |
| Database | MongoDB with Mongoose 9 |
| Real-time | Socket.IO 4 |
| Templates | EJS |
| Auth | express-session + bcryptjs |
| Session store | connect-mongo |
| Maps | Leaflet.js + OpenStreetMap tiles |
| Geolocation | HTML5 Geolocation API |
| i18n | i18n package (EN + HI) |
| Validation | express-validator |
| Rate limiting | express-rate-limit |
| Testing | Jest 30 + Supertest 7 + mongodb-memory-server |

---

## How It Works

### Authentication

Users, drivers, and hospitals each have separate login flows but share the same session mechanism (`express-session`). The session stores `role`, `id`, and for drivers a `driverId` (since drivers have both a `User` document and a `Driver` document).

The `protect` middleware checks for a valid session; `restrictTo('driver')` additionally checks that `driverId` is present.

### Booking flow

1. A patient submits a booking with pickup/drop GeoJSON coordinates. The server validates input and creates the `Booking` document with `status: 'pending'`.
2. A Socket.IO event (`newBookingAlert`) is emitted to the `drivers` room so all verified, available drivers see the new request in real time.
3. A driver accepts via `POST /booking/accept/:bookingId`. The server uses `findOneAndUpdate` with an `__v` guard — only one driver can win; the loser gets a `409 Conflict`.
4. The winning driver's dashboard starts a `setInterval` calling `PUT /driver/location` every 10 seconds. A `driverLocationUpdate` Socket.IO event carries coordinates and a rough ETA to the patient's map.
5. The driver updates status to `inProgress`, then `completed`. On completion `isAvailable` resets to `true` and the patient is prompted to rate.

### Anonymous requests

`POST /booking/anonymous-request` takes just `[longitude, latitude]` — no session required, rate-limited at 5/hour/IP. It creates a booking with `type: 'anonymous'` and emits `anonymousRequestAlert` to all drivers.

### Geospatial

`GET /driver/nearby` uses MongoDB's `$near` operator with a default 5 km radius. MongoDB `2dsphere` indexes are defined on Driver location, Booking pickup/drop, and Hospital location fields.

---

## Project Structure

```
src/
├── app.js                     # Express + Socket.IO setup, route mounting
├── start.js                   # Process entry point (mongoose.connect + server.listen)
├── controllers/
│   ├── adminController.js     # Platform stats, driver verification, stale booking management
│   ├── authController.js      # User / driver register + login
│   ├── bookingController.js   # Booking CRUD, accept/cancel/rate, anonymous requests
│   ├── driverController.js    # Driver profile, location update, nearby query, ETA
│   └── hospitalController.js  # Hospital auth, dashboard, bed updates, ambulance locations
├── models/
│   ├── User.js                # Patient accounts + driver user records
│   ├── Driver.js              # Driver profile, live location, verification status
│   ├── Booking.js             # Booking schema: GeoJSON, status lifecycle, statusHistory audit
│   └── Hospital.js            # Hospital profile with ward capacity fields
├── routes/
│   ├── admin.js               # /admin — admin-only endpoints
│   ├── auth.js                # /auth — register / login / logout
│   ├── booking.js             # /booking — booking lifecycle
│   ├── driver.js              # /driver — driver dashboard + API
│   ├── hospital.js            # /hospital — hospital dashboard + API
│   └── user.js                # /user — user dashboard + profile
├── middleware/
│   ├── authMiddleware.js      # protect() and restrictTo() session guards
│   ├── rateLimiters.js        # express-rate-limit configurations
│   └── validate.js            # express-validator rule sets + handleValidationErrors
├── sockets/
│   └── index.js               # Socket.IO event handlers, room management
├── utils/
│   ├── catchAsync.js          # Wraps async controllers in a try/catch
│   └── notify.js              # Typed Socket.IO emit helper
├── config/i18n.js             # i18n config, reads from locales/
├── locales/                   # en.json and hi.json translation files
└── views/                     # EJS templates for all three roles
tests/
├── setup/
│   ├── env.js                 # Sets NODE_ENV=test + test secrets before Jest initialises
│   ├── db.js                  # 3-tier DB helper (MMS → localhost → MONGO_TEST_URI)
│   └── helpers.js             # Factory functions: createUser, createDriver, createBooking …
├── unit/
│   ├── fare.test.js           # Haversine fare calculation (5 tests — PASSING)
│   └── notify.test.js         # Socket.IO notify helper (7 tests — PASSING)
└── integration/
    ├── auth.test.js           # Register, login, current-user, logout (10 tests)
    ├── booking.test.js        # Full booking lifecycle (13 tests)
    ├── admin.test.js          # Admin endpoints and auth guards (9 tests)
    └── concurrency.test.js    # Simultaneous acceptBooking → exactly one 200, one 409
```

---

## Getting Started

**Requirements**
- Node.js ≥18
- MongoDB ≥5 (local or Atlas)

**Setup**

```bash
git clone https://github.com/Surajgupta6/Rapid-Relief.git
cd Rapid-Relief
npm install
```

Copy the environment template and fill in your values:

```bash
# macOS / Linux
cp .env.example .env

# Windows
copy .env.example .env
```

Generate a secure `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Open `http://localhost:3000` (or the `PORT` you configured).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string — local or Atlas |
| `SESSION_SECRET` | Yes | Signs the session cookie — use a long random string |
| `JWT_SECRET` | Yes | Reserved for future JWT use — set to any non-empty string |
| `PORT` | No | HTTP port; defaults to `3000` |
| `NODE_ENV` | No | Set to `production` to suppress stack traces in API error responses |

---

## API Reference

Full request/response documentation is in [`docs/engineering/API.md`](docs/engineering/API.md).

### Auth — `/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register a new user |
| POST | `/auth/register-driver` | Public | Register a driver (linked to a hospital) |
| POST | `/auth/login` | Public | Log in, create session cookie |
| GET | `/auth/logout` | Session | Destroy session |
| GET | `/auth/current-user` | Session | Return session user object |

### Bookings — `/booking`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/booking/anonymous-request` | Public (rate-limited) | Emergency request — coordinates only, no login needed |
| POST | `/booking` | User | Create a new booking with patient details + coordinates |
| GET | `/booking/user` | User | List all bookings for the logged-in user |
| GET | `/booking/driver` | Driver | Driver's bookings + all unassigned pending bookings |
| GET | `/booking/driver/current` | Driver | Active booking in `accepted` or `inProgress` state |
| POST | `/booking/accept/:bookingId` | Driver | Accept a pending booking (concurrency-safe) |
| POST | `/booking/decline/:bookingId` | Driver | Decline; driver added to `declinedBy` array |
| POST | `/booking/:id/status` | Driver | Advance status to `inProgress` or `completed` |
| POST | `/booking/:id/cancel` | User / Driver | Cancel if still `pending` or `accepted` |
| POST | `/booking/:id/rate` | User | Rate a completed booking (1–5 stars) |

### Driver — `/driver`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/driver/dashboard` | Driver | Render driver dashboard view |
| GET | `/driver/profile` | Driver | Get driver profile |
| PUT | `/driver/profile` | Driver | Update profile and ambulance details |
| PUT | `/driver/location` | Driver | Save current GPS coordinates to DB |
| GET | `/driver/nearby` | Driver | Find drivers within radius using `$near` |
| GET | `/driver/bookings` | Driver | Driver's booking history |

### Hospital — `/hospital`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/hospital/register` | Public | Register a hospital |
| POST | `/hospital/login` | Public | Hospital login |
| GET | `/hospital/dashboard` | Hospital | Hospital dashboard view |
| PATCH | `/hospital/update-beds` | Hospital | Update available beds per ward |
| GET | `/hospital/ambulance-locations` | Hospital | Coordinates of all associated drivers |
| PATCH | `/hospital/update-location` | Hospital | Update hospital coordinates |

### Admin — `/admin`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/stats` | Admin | Platform statistics (users, drivers, hospitals, bookings) |
| GET | `/admin/drivers` | Admin | List all drivers with verification status |
| GET | `/admin/drivers/stale` | Admin | Drivers not seen in >24 hours |
| POST | `/admin/drivers/:driverId/verify` | Admin | Mark driver as verified (enters dispatch pool) |
| POST | `/admin/drivers/:driverId/revoke` | Admin | Revoke driver verification |
| GET | `/admin/bookings/stale` | Admin | Bookings stuck in pending/accepted for >2 hours |
| POST | `/admin/bookings/:bookingId/force-cancel` | Admin | Force-cancel a stale booking |

### User — `/user`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/user/dashboard` | User | User dashboard view |
| GET | `/user/profile` | User | User profile view |
| GET | `/user/bookings` | User | User booking history view |
| POST | `/user/update-profile` | User | Update name, phone, address, password |

---

## Running Tests

**Unit tests** (no database required — always runnable):

```bash
npm run test:unit
```

**Integration tests** (requires a running MongoDB instance):

```bash
# Start MongoDB first, then:
set MONGO_TEST_URI=mongodb://localhost:27017/rapid-relief-test
npm run test:integration
```

**All tests with coverage:**

```bash
set MONGO_TEST_URI=mongodb://localhost:27017/rapid-relief-test
npm run test:coverage
```

**Test results summary:**

| Suite | Tests | Status |
|---|---|---|
| `unit/fare.test.js` | 5 | ✅ Passing |
| `unit/notify.test.js` | 7 | ✅ Passing |
| `integration/auth.test.js` | 10 | Requires MongoDB |
| `integration/booking.test.js` | 13 | Requires MongoDB |
| `integration/admin.test.js` | 9 | Requires MongoDB |
| `integration/concurrency.test.js` | 1 | Requires MongoDB |

---

## Branch Strategy

| Branch | Contents |
|---|---|
| `main` | Original codebase |
| `phase-1-security-foundation` | Auth guards, input validation, rate limiting, bug fixes |
| `phase-2-emergency-lifecycle` | Booking status lifecycle, business rules, `statusHistory` audit |
| `phase-3-concurrency-dispatch` | Atomic dispatch, optimistic locking, driver identity fixes |
| `phase-4-db-reliability` | Transactions, audit trails, stale detection, admin endpoints |
| `phase-5-realtime-tracking` | Socket.IO rooms, `notify()` helper, live location tracking |
| `phase-6-testing` | Jest + Supertest suite, mongodb-memory-server, 12 passing unit tests |
| `phase-7-docs` | This README, API documentation, engineering docs |

---

## Known Limitations

- **No real "nearest driver" assignment** — bookings go to all verified drivers and whoever accepts first wins (closest-first selection is a planned enhancement)
- **Driver initial coordinates are `[0, 0]`** — until the driver manually updates their location via `PUT /driver/location`
- **JWT not in use** — `jsonwebtoken` is installed and `JWT_SECRET` is in the env, but current auth is entirely session-based
- **Language switching is basic** — the locale files exist and cookie-based switching works, but not all UI strings are translated

---

## License

ISC

# Rapid Relief — Phase 0: Initial Engineering Audit

**Date:** 2026-10-28  
**Auditor:** Automated senior-engineer audit (Phase 0)  
**Branch audited:** `main` (commit `8e716a9`)  
**Scope:** Read-only inspection. No application code, dependencies, or database records were modified.

---

## 1. Executive Summary

Rapid Relief is an early-stage Node.js/Express web application that lets patients book ambulances, drivers accept or decline those bookings, and hospitals monitor their fleet. The core booking lifecycle, session-based authentication, and Socket.IO real-time notifications are partially implemented. The project is at a working prototype stage: the happy path functions, but several correctness bugs, a critical race condition in ambulance dispatch, a live debug endpoint (now removed in uncommitted changes), zero tests, and no production hardening exist.

The five most serious issues found are:

1. **Critical race condition** — Two drivers can accept the same booking simultaneously (`findById` + `status check` + `save` is not atomic).
2. **Broken auth guard** — `updateBookingStatus` and `getDriverCurrentBooking` use a JavaScript operator-precedence bug (`!req.session?.user?.role === 'driver'`) that always evaluates to `false`, effectively disabling the auth check.
3. **Duplicate driver registration path** — Three separate code paths create drivers (`authController.register`, `authController.registerDriver`, `driverController.register`), with differing field sets, leading to schema inconsistencies between `User` and `Driver` documents.
4. **Socket.IO has no authentication** — Any anonymous WebSocket client can emit privileged events (`updateDriverLocation`, `bookingAccepted`, `bookingStatusUpdate`) without a session check.
5. **Zero automated tests** — No unit, integration, or concurrency tests exist. Correctness of every feature is entirely unverified.

---

## 2. Project Purpose and Actual Technology Stack

### Purpose

Emergency ambulance booking platform with three user roles — **patient (user)**, **driver**, and **hospital** — supporting real-time dispatch, live GPS tracking, and hospital bed management.

### Technology Stack (verified from source)

| Layer | Technology | Version (package.json) |
|---|---|---|
| Runtime | Node.js | ≥ 14 (not pinned in `package.json`) |
| HTTP framework | Express | `^4.18.2` |
| Database | MongoDB (via Mongoose) | `^6.9.1` |
| Session store | connect-mongo | `^4.6.0` |
| Authentication | express-session + bcryptjs | `^1.18.1` / `^2.4.3` |
| JWT library | jsonwebtoken | `^9.0.2` (**installed, unused**) |
| Real-time | Socket.IO | `^4.6.1` |
| Template engine | EJS | `^3.1.8` |
| Internationalisation | i18n | `^0.15.1` (EN + HI locale files) |
| Maps (client) | Leaflet.js + OpenStreetMap | loaded from CDN in views |
| Geolocation (client) | HTML5 Geolocation API | browser native |
| HTTP logging | morgan | `^1.10.0` |
| Cookie parsing | cookie-parser | `^1.4.7` |
| Dev reload | nodemon | `^2.0.20` (devDep) |
| **Testing** | **none** | **—** |
| **Linting** | **none** | **—** |
| **Docker** | **none** | **—** |
| **CI/CD** | **none** | **—** |

> [!NOTE]
> `jsonwebtoken` is listed as a production dependency but is imported only in `src/middleware/authMiddleware.js` at the top of the file and never actually called. JWT-based auth is not implemented anywhere.

---

## 3. Existing Application Architecture

The application follows a **monolithic MVC** structure: Express routes → controllers → Mongoose models. All Socket.IO logic lives directly in `src/app.js`. There is no dedicated service layer — business logic is inline in controllers.

```
Client (EJS/browser)
      │
      ▼
Express HTTP (src/app.js)
      │
      ├── /auth           → authController
      ├── /user           → user routes (inline handlers)
      ├── /booking        → bookingController
      ├── /driver/api     → driverController
      ├── /hospital       → hospitalController
      ├── /driver/*       → driverController (page routes, duplicated in app.js)
      │
Socket.IO (inline in app.js)
      │  events: register, updateDriverLocation, newBooking,
      │          bookingAccepted, bookingStatusUpdate, driverAvailabilityUpdate
      │
Mongoose → MongoDB
      ├── User
      ├── Driver
      ├── Booking
      ├── Hospital
      └── DriverStatus  (defined but unused in active code)
```

### Dead / Orphaned Code

| File | Status |
|---|---|
| `src/utils/socketService.js` | Defines `initializeSocket` with a different Socket.IO setup; **never imported** by `app.js`. Dead code. |
| `src/config/socket.js` | Another Socket.IO initializer with room-based routing; **never imported** by `app.js`. Dead code. |
| `src/models/DriverStatus.js` | Schema defined; only referenced by the dead `socketService.js`. Never queried by active code. |
| `src/middleware/auth.js` | Defines `isAuthenticated`, `isDriver`, `isUser`, `isAdmin`, `requireAuth`, `protect`, `restrictTo`; **not imported anywhere**. `authMiddleware.js` is used instead. |
| `src/components/driver/BookingTab.jsx` | React component; the project has no React build pipeline. This file cannot be rendered. |
| `src/styles/BookingTab.css` | CSS for the above orphaned React component. |

---

## 4. Directory Structure and Important Files

```
d:\Rapid Relief\
├── .env                        # ⚠ Tracked? (see gitignore note)
├── .env.example                # ✅ Untracked (added in uncommitted changes)
├── .gitignore                  # node_modules/, .env, .env.local, .env.*.local
├── package.json
├── package-lock.json
├── README.md                   # Modified in working tree (improved documentation)
├── public/js/main.js           # Minimal client JS (root-level public dir)
├── src/
│   ├── app.js                  # Entry point; Socket.IO inline; ⚠ debug route removed in WIP
│   ├── config/
│   │   ├── i18n.js             # i18n configuration
│   │   └── socket.js           # ⚠ DEAD — never imported
│   ├── controllers/
│   │   ├── authController.js   # User + driver register/login/logout
│   │   ├── bookingController.js# Full booking lifecycle
│   │   ├── driverController.js # Driver profile, location, dashboard, acceptBooking
│   │   └── hospitalController.js
│   ├── middleware/
│   │   ├── auth.js             # ⚠ DEAD — never imported
│   │   └── authMiddleware.js   # ✅ Active: protect + restrictTo
│   ├── models/
│   │   ├── Booking.js
│   │   ├── Driver.js
│   │   ├── DriverStatus.js     # ⚠ DEAD — unused in active code
│   │   ├── Hospital.js
│   │   └── User.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── booking.js
│   │   ├── driver.js           # Mounted at /driver/api
│   │   ├── hospital.js
│   │   └── user.js
│   ├── utils/
│   │   ├── catchAsync.js       # ✅ Used by driverController, hospitalController
│   │   └── socketService.js    # ⚠ DEAD — never imported
│   ├── components/driver/
│   │   └── BookingTab.jsx      # ⚠ DEAD — no React pipeline
│   ├── locales/
│   │   ├── en.json
│   │   └── hi.json
│   ├── public/                 # Static assets served from /
│   │   ├── css/styles.css
│   │   ├── images/
│   │   ├── js/main.js
│   │   ├── js/translations.js
│   │   └── styles/driver-dashboard.css
│   └── views/                  # EJS templates
│       ├── index.ejs
│       ├── auth/
│       ├── driver/
│       ├── hospital/
│       ├── partials/
│       └── user/
└── docs/engineering/           # Created by this audit
    └── INITIAL_AUDIT.md
```

> [!WARNING]
> The `.gitignore` does not ignore `*.log`, `coverage/`, `dist/`, or `build/`. These should be added before production use.

---

## 5. Implemented Features

| Feature | Status | Notes |
|---|---|---|
| User registration | ✅ Implemented | `authController.register`; bcrypt via `User.pre('save')` |
| User login | ✅ Implemented | Session-based; `comparePassword` uses bcrypt |
| User logout | ✅ Implemented | `req.session.destroy()` |
| Driver registration (API) | ⚠ Partial | Three separate code paths; schema fields differ |
| Driver registration (web form) | ✅ Implemented | `driverController.register`; creates User + Driver documents |
| Driver login (web form) | ✅ Implemented | `driverController.login` |
| Hospital registration/login | ✅ Implemented | Separate collection; bcrypt |
| Role-based middleware | ✅ Implemented | `authMiddleware.protect` + `restrictTo` |
| Booking creation (regular) | ✅ Implemented | GeoJSON pickup/drop; Socket.IO alert to `drivers` room |
| Anonymous booking | ✅ Implemented | No user account required |
| Driver booking list | ✅ Implemented | Shows own + pending unassigned bookings |
| Driver accept booking | ⚠ Bug | Race condition; also two conflicting implementations |
| Driver decline booking | ✅ Implemented | `declinedBy` array pushed |
| Booking status transitions | ⚠ Bug | Auth guard broken (see SEC-003) |
| Booking cancellation | ✅ Implemented | Validates caller owns the booking |
| Booking rating | ✅ Implemented | 1–5 rating; updates driver rolling average |
| Driver location update (HTTP) | ✅ Implemented | PUT `/driver/api/location` |
| Live location (Socket.IO) | ⚠ Partial | Client emits `updateDriverLocation`; server relays to `booking_<id>` room; no auth |
| Driver availability toggle | ✅ Implemented | `updateAvailability` endpoint |
| Hospital dashboard | ✅ Implemented | Shows drivers + recent bookings |
| Hospital bed update | ✅ Implemented | PATCH `/hospital/update-beds` |
| Hospital ambulance locations | ✅ Implemented | Returns driver coordinates |
| Nearby driver search | ✅ Implemented | `$near` geospatial query |
| Fare calculation | ✅ Implemented | Haversine formula; ₹100 base + ₹15/km |
| i18n (EN/HI) | ✅ Implemented | Cookie-based language switch |
| Admin role | ❌ Not implemented | `role: 'admin'` exists in schema; no admin routes/UI |
| Input validation library | ❌ Not present | Manual checks only |
| Password reset / forgot password | ❌ Not implemented | |
| Rate limiting | ❌ Not implemented | |
| Security headers | ❌ Not implemented | |

---

## 6. Verified Defects and Unverified Risks

### Confirmed Defects (code-verified)

#### DEF-001 — Race condition in `acceptBooking`
**File:** [`src/controllers/bookingController.js` L208–230](file:///d:/Rapid%20Relief/src/controllers/bookingController.js#L208-L230)  
**Evidence:**
```js
const booking = await Booking.findById(bookingId);
if (booking.status !== 'pending') { /* reject */ }
// ← NO LOCK. Another request can pass this check simultaneously.
booking.status = 'accepted';
booking.driver = driverId;
await booking.save();
```
**Impact:** Two drivers submitting at the same millisecond can both pass the `status !== 'pending'` check and both save, resulting in one booking with two conflicting driver assignments (last write wins).  
**Fix:** Use MongoDB's `findOneAndUpdate` with a filter that atomically matches `status: 'pending'` and sets `status: 'accepted'`:
```js
const booking = await Booking.findOneAndUpdate(
  { _id: bookingId, status: 'pending' },
  { status: 'accepted', driver: driverId, acceptedAt: new Date() },
  { new: true }
);
if (!booking) return res.status(409).json({ message: 'Booking already accepted' });
```

#### DEF-002 — Broken authentication guard (operator precedence bug)
**Files:** [`src/controllers/bookingController.js` L269](file:///d:/Rapid%20Relief/src/controllers/bookingController.js#L269), [L570](file:///d:/Rapid%20Relief/src/controllers/bookingController.js#L570)  
**Evidence:**
```js
// In updateBookingStatus and getDriverCurrentBooking:
if (!req.session?.user?.role === 'driver' || !req.session?.user?.driverId) {
```
Due to JavaScript operator precedence, `!req.session?.user?.role` is evaluated first (always `false` for a truthy string), so the entire condition evaluates to `false`. **The auth guard never fires.** Any authenticated user — or depending on the `||` branch, even a user without `driverId` — can call `updateBookingStatus`.  
**Fix:**
```js
if (req.session?.user?.role !== 'driver' || !req.session?.user?.driverId) {
```

#### DEF-003 — `driverController.acceptBooking` uses wrong ID
**File:** [`src/controllers/driverController.js` L560](file:///d:/Rapid%20Relief/src/controllers/driverController.js#L560)  
**Evidence:**
```js
const driverId = req.session.user.id;  // ← This is the USER _id, not the Driver _id
const driver = await Driver.findById(driverId); // Will always return null
```
Session stores `{ id: user._id, driverId: driver._id }`. The driver lookup will always fail because `user._id ≠ driver._id`. The correct field is `req.session.user.driverId`.  
**Impact:** The `driverController.acceptBooking` function (mounted at a separate route in `driver.js`) will always return 404. This is separate from `bookingController.acceptBooking` which uses `driverId` correctly.

#### DEF-004 — `setInterval` stored in Mongoose document
**File:** [`src/controllers/driverController.js` L604–624](file:///d:/Rapid%20Relief/src/controllers/driverController.js#L604-L624)  
**Evidence:**
```js
const locationUpdateInterval = setInterval(async () => { ... }, 10000);
booking.locationUpdateInterval = locationUpdateInterval; // stores a Timeout object
await booking.save(); // Mongoose ignores unknown fields silently
```
`locationUpdateInterval` is not a schema field; Mongoose drops it silently. The interval is never cleared when the booking completes or the server restarts — it becomes a **timer leak** that keeps querying the database every 10 seconds indefinitely per accepted booking.  
**Impact:** Memory and DB query leak; each server restart abandons orphaned timers.

#### DEF-005 — Duplicate driver identity (User + Driver document)
**File:** [`src/controllers/driverController.js` L253–289](file:///d:/Rapid%20Relief/src/controllers/driverController.js#L253-L289)  
**Evidence:** Driver registration creates both a `User` document (with `email`, `password`, `role: 'driver'`) and a `Driver` document (also with `email`, `password`). The `Driver` model has its own `pre('save')` bcrypt hook, so the password is hashed twice independently. The `Driver.password` field is separate from `User.password`.  
**Impact:** Data integrity issue; login works against `User.password` (via `comparePassword`), not `Driver.password`. If a driver's `User` and `Driver` passwords diverge, behavior becomes unpredictable.

#### DEF-006 — `user.correctPassword` called in `user.js` router
**File:** [`src/routes/user.js` L67](file:///d:/Rapid%20Relief/src/routes/user.js#L67)  
**Evidence:**
```js
const isPasswordValid = await user.correctPassword(currentPassword, user.password);
```
The `User` model defines `comparePassword(candidatePassword)` (one argument using `this.password`), not `correctPassword`. This call will throw `TypeError: user.correctPassword is not a function` whenever a user attempts to change their password.

#### DEF-007 — `POST /booking` is unauthenticated
**File:** [`src/routes/booking.js` L8](file:///d:/Rapid%20Relief/src/routes/booking.js#L8)  
**Evidence:** `router.post('/', bookingController.createBooking)` is defined **before** `router.use(authMiddleware.protect)`. However, `createBooking` reads `req.session.user.id` directly at L32:
```js
user: req.session.user.id,
```
An unauthenticated caller triggers an unhandled `TypeError: Cannot read properties of undefined (reading 'id')`, which falls through to the generic 500 handler rather than a clean 401.  
**Fix:** Move `POST /` inside the protected middleware, or add an explicit session check.

### Unverified Risks (pattern-based, require runtime confirmation)

| ID | Risk | Location | Notes |
|---|---|---|---|
| RISK-001 | Coordinate injection | All GeoJSON inputs | `coordinates` arrays are never validated for range (lng: −180–180, lat: −90–90) |
| RISK-002 | Session fixation | Login handlers | `req.session.regenerate()` is never called before writing a new session after login |
| RISK-003 | Denial-of-service via large payloads | `express.json()` | No body size limit set; default is 100 KB but not explicit |
| RISK-004 | MongoDB `$near` without distance cap | `GET /driver/api/nearby` | `maxDistance` comes from request body; user can supply `maxDistance: 999999999` |
| RISK-005 | Anonymous booking spam | `POST /booking/anonymous-request` | No auth, no rate limit; a bot can flood the driver notification queue |
| RISK-006 | Driver `isVerified` never set to `true` | `Driver.isVerified` defaults `false`; no admin flow exists to verify | Drivers can accept bookings while unverified |

---

## 7. Security Findings

### SEC-001 (P0) — Session secret falls back to a hardcoded string
**File:** [`src/app.js` L62](file:///d:/Rapid%20Relief/src/app.js#L62)  
```js
secret: process.env.SESSION_SECRET || 'your-secret-key',
```
If `SESSION_SECRET` is unset, the application signs sessions with the literal string `'your-secret-key'`. An attacker who knows this string can forge valid session cookies.  
**Fix:** Remove the fallback entirely; crash on startup if `SESSION_SECRET` is missing or shorter than 32 characters.

### SEC-002 (P0) — Socket.IO has zero authentication
**File:** [`src/app.js` L82–159](file:///d:/Rapid%20Relief/src/app.js#L82-L159)  
Any browser tab or `curl` script can open a WebSocket and:
- Emit `updateDriverLocation` with an arbitrary `driverId` and `bookingId`, spoofing another driver's GPS position.
- Emit `bookingAccepted` with any `bookingId` and `driverId`, injecting false booking-accepted events to all clients.
- Emit `bookingStatusUpdate` with arbitrary status data.

There is no session cookie check on any Socket.IO event handler.  
**Fix:** Add a Socket.IO middleware that reads `socket.request.session` (via `express-session` integration) and rejects unauthenticated connections. Validate that the emitting driver's session `driverId` matches the event payload.

### SEC-003 (P1) — Auth guard bypassed by operator precedence (same as DEF-002)
**File:** `src/controllers/bookingController.js` L269  
Any authenticated user (patient or hospital) can call `POST /booking/:id/status` and change a booking's status.

### SEC-004 (P1) — Internal error messages leaked to clients
**Files:** `src/controllers/authController.js` L66 (`err.message` in catch), `src/controllers/bookingController.js` L77 (`err.message`), `src/controllers/bookingController.js` L438 (`err.message`)  
**Evidence:**
```js
res.status(500).json({ status: 'error', message: err.message });
```
Mongoose validation errors, connection strings, and stack-related strings can be exposed. `NODE_ENV === 'development'` guard is inconsistently applied.  
**Fix:** Return generic messages in production; log full error server-side.

### SEC-005 (P1) — No CORS configuration on HTTP routes
**File:** `src/app.js`  
The Express app has no CORS headers. The Socket.IO instance in `src/utils/socketService.js` (dead code) does configure `cors: { origin: '*' }`, but the live Socket.IO instance in `app.js` does not specify any CORS options, inheriting Socket.IO defaults.  
**Fix:** Add the `cors` npm package; configure allowed origins explicitly.

### SEC-006 (P1) — No HTTP security headers
No `helmet` middleware or manual `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy` headers are set.  
**Fix:** Add `helmet` as a dependency and call `app.use(helmet())` early in the middleware chain.

### SEC-007 (P1) — No rate limiting on auth endpoints
`POST /auth/login`, `POST /driver/login`, `POST /hospital/login` have no rate limiting. A brute-force attack on user passwords is unrestricted.  
**Fix:** Add `express-rate-limit`; apply strict limits (e.g. 10 requests/15 minutes) to all auth endpoints.

### SEC-008 (P2) — `.gitignore` missing build artefacts and logs
**File:** `.gitignore`  
Only `node_modules/`, `.env`, `.env.local`, `.env.*.local` are ignored. `npm-debug.log`, `yarn-error.log`, `coverage/`, `*.log` are not ignored.  
**Fix:** Expand `.gitignore` with standard Node.js patterns.

### SEC-009 (P2) — Session cookie not marked `httpOnly` / `secure`
**File:** `src/app.js` L69–71  
The session cookie configuration sets only `maxAge`. `httpOnly: true` is the Express default, but `secure: true` (HTTPS only) and `sameSite: 'strict'` are not set.  
**Fix:**
```js
cookie: {
  maxAge: 1000 * 60 * 60 * 24,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict'
}
```

### SEC-010 (P2) — No input validation library
All validation is manual (`if (!field)` checks). There is no email format validation, phone number format validation, or coordinate range enforcement. This permits malformed data to reach the database.  
**Fix:** Add `express-validator` or `joi` and apply request schemas to every route.

### SEC-011 (P2) — `morgan('dev')` in production
**File:** `src/app.js` L43  
Morgan `dev` format logs request URLs and response codes, which can expose query parameters (including sensitive ones) in production logs.  
**Fix:** Use `morgan('combined')` for production and `morgan('dev')` only in development.

### SEC-012 (P3) — `GET /auth/logout` — session destruction via GET
**File:** `src/routes/auth.js` L10  
Using a GET request for a state-changing action (session destruction) is susceptible to CSRF logout. Change to POST.

### SEC-013 (P3) — Password sent in driver registration to Driver model separately
**File:** `src/controllers/driverController.js` L268–269  
The plaintext password from the request body is passed directly into `new Driver({ ..., password })`. The `Driver.pre('save')` hook then hashes it. This is functionally safe but architecturally wrong — the password is stored in two separate documents (User and Driver).

---

## 8. Database and Concurrency Findings

### DB-001 (P0) — Non-atomic booking acceptance (same as DEF-001)
**Root cause:** MongoDB document reads and writes are not automatically serialised. The sequence `findById` → check `status` → `save` is a read-modify-write pattern that is not atomic. Under concurrent load, two drivers calling `POST /booking/accept/:id` within the same few milliseconds can both read `status: 'pending'`, both pass the check, and both write `status: 'accepted'` with different `driver` fields. The last write wins but both received 200 OK.  
**Recommended fix:** Use `findOneAndUpdate` with a conditional filter (see DEF-001 fix). This is a single atomic MongoDB operation using document-level locking.

### DB-002 (P1) — Driver default coordinates `[0, 0]`
**File:** `src/controllers/driverController.js` L275–278  
All newly registered drivers start at coordinates `[0, 0]` (the Gulf of Guinea off the coast of Africa). Any geospatial `$near` query will return these drivers as if they were at longitude 0, latitude 0 until they update their location. This can cause incorrect nearest-driver results.  
**Fix:** Do not run geospatial queries against drivers who have never updated their location. Add a `locationSetAt` timestamp field; filter out drivers where `locationSetAt` is null.

### DB-003 (P1) — `declined` status permanently blocks a booking
**File:** `src/controllers/bookingController.js` L535  
When a driver declines, `booking.status` is set to `'declined'`. No code attempts to re-broadcast the declined booking to other available drivers. The booking is effectively dead after one driver declines.  
**Fix:** Do not change the booking status to `'declined'`; instead only push to `declinedBy` and leave status as `'pending'`. Filter out `declinedBy` drivers when querying available drivers.

### DB-004 (P1) — `cancelBooking` does not restore driver availability atomically
**File:** `src/controllers/bookingController.js` L416–425  
The cancel handler sets `booking.status = 'cancelled'` and then separately calls `Driver.findByIdAndUpdate(booking.driver, { isAvailable: true })`. These are two separate operations. If the server crashes between them, the driver stays marked as unavailable indefinitely.  
**Fix:** These should be in a logical transaction or at minimum the driver update should happen first; pair with a periodic reconciliation job.

### DB-005 (P2) — No geospatial index on `Booking.pickupLocation` in queries
The `Booking` schema defines a `2dsphere` index on `pickupLocation` and `dropLocation`, but the current code never uses `$near` or `$geoWithin` on bookings — only on `Driver.location`. The booking indexes are unused and waste storage/write overhead.

### DB-006 (P2) — `DriverStatus` model is completely unused
The `DriverStatus` collection is created by `src/models/DriverStatus.js` but no active code path reads from or writes to it. It only appears in the dead `socketService.js`. This creates a confusing schema artefact.

### DB-007 (P2) — No audit trail for booking state changes
There is no history log of who changed a booking's status or when (beyond the limited `acceptedAt`, `startedAt`, `completedAt` fields). For an emergency service, a full audit log is operationally and legally important.

### DB-008 (P3) — Unvalidated `$near` distance input
**File:** `src/controllers/driverController.js` L146  
`maxDistance` comes directly from `req.body` without bounding. A caller can request a 10,000 km radius and retrieve all drivers in the database in one query.

---

## 9. Testing Gaps

**No test files exist in the project** (excluding node_modules). The following are entirely untested:

| Category | Missing Tests |
|---|---|
| Unit | `calculateFare` Haversine accuracy; `catchAsync` error propagation; model validators |
| Auth | Register with duplicate email; login with wrong password; session persistence; role enforcement |
| Booking lifecycle | Create → accept (happy path); concurrent accept (race condition); decline; cancel; complete; rate |
| Authorization | Patient calling driver-only endpoints; driver calling hospital-only endpoints; unauthenticated calls |
| Socket.IO | Unauthenticated connection; location broadcast; booking notification |
| Geospatial | `$near` returning drivers in order; `[0,0]` driver filtering |
| Error paths | Missing required fields; invalid coordinates; booking not found |
| Concurrency | Simultaneous booking acceptance (requires test database + parallel requests) |

**Missing tooling:**
- No test runner (`jest`, `mocha`, `vitest`)
- No assertion library
- No HTTP test client (`supertest`)
- No linter (`eslint`)
- No formatter (`prettier`)
- No coverage tool

---

## 10. Documentation and Configuration Gaps

| Item | Status | Notes |
|---|---|---|
| README | ✅ Good (uncommitted) | Uncommitted README is substantially better; documents API, known limitations, and env vars |
| `.env.example` | ✅ Present (uncommitted) | Needs to be committed |
| API documentation | ⚠ Partial | Only in README; no OpenAPI/Swagger spec |
| `docs/` directory | ❌ Missing before this audit | |
| Docker / docker-compose | ❌ Not present | |
| GitHub Actions | ❌ Not present | |
| `.gitignore` | ⚠ Minimal | Missing `*.log`, `coverage/`, `dist/` |
| Node.js version pinning | ❌ Missing | No `.nvmrc` or `engines` field in `package.json` |
| ESLint config | ❌ Missing | |
| Prettier config | ❌ Missing | |

---

## 11. Recommended Improvements (Prioritised)

### Must-Fix Before Any Production Use

1. **Fix the race condition** (DEF-001/DB-001) — Use atomic `findOneAndUpdate` with status filter.
2. **Fix the broken auth guard** (DEF-002/SEC-003) — Operator precedence fix in two places.
3. **Add Socket.IO authentication** (SEC-002) — Session middleware on all socket event handlers.
4. **Remove the hardcoded session secret fallback** (SEC-001) — Fail fast on missing secret.
5. **Fix `driverController.acceptBooking` wrong ID** (DEF-003) — Use `req.session.user.driverId`.
6. **Fix `user.correctPassword` call** (DEF-006) — Rename to `comparePassword`.

### High Value for SDE Interview Portfolio

7. **Write comprehensive tests** — `jest` + `supertest`; unit + integration + auth tests.
8. **Add `helmet`** — One-line security header improvement.
9. **Add `express-rate-limit`** on auth endpoints.
10. **Add `express-validator`** schemas for all routes.
11. **Fix the `declined` status bug** (DB-003) — Proper re-broadcast logic.
12. **Clear dead code** — Remove `socketService.js`, `config/socket.js`, `middleware/auth.js`, `DriverStatus.js`, `BookingTab.jsx`.
13. **Consolidate driver registration** — Single code path; remove duplicate `User`/`Driver` password fields.
14. **Add CORS configuration** and `secure` + `sameSite` cookie attributes.
15. **Add OpenAPI (Swagger) documentation**.

---

## 12. Prioritised Implementation Roadmap

### Phase 1 — Backend Foundation and Security
- Fix all P0/P1 security findings (SEC-001 through SEC-007)
- Fix all confirmed P0/P1 defects (DEF-001 through DEF-007)
- Add `helmet`, CORS, `express-rate-limit`, cookie hardening
- Pin Node.js version in `.nvmrc` and `package.json#engines`
- Expand `.gitignore`; commit `.env.example`
- Remove dead code files

### Phase 2 — Emergency Lifecycle and Business Rules
- Fix `declined` status re-broadcast logic (DB-003)
- Add proper state machine for booking transitions (validate all transitions server-side)
- Add driver verification gate (prevent unverified drivers from accepting bookings)
- Add coordinate range validation
- Add `locationSetAt` field; filter `[0,0]` drivers from dispatch queries

### Phase 3 — Concurrency-Safe Ambulance Dispatch
- Implement atomic `findOneAndUpdate` accept pattern
- Design and implement nearest-driver dispatch (select closest available driver, not any driver)
- Add idempotency keys to booking creation (prevent duplicate anonymous requests)

### Phase 4 — Database Reliability, Idempotency, and Audit Trails
- Add `BookingEvent` audit log model (who changed what and when)
- Add `cancelledAt` to Booking schema and populate it on cancel
- Clean up `DriverStatus` model or connect it to the active code path
- Add database-level concurrency tests

### Phase 5 — Secure Real-Time Tracking and Notifications
- Add Socket.IO authentication middleware (session cookie validation)
- Validate all Socket.IO event payloads server-side
- Remove the `setInterval` timer leak (DEF-004); move location broadcasting to driver HTTP calls
- Replace `io.emit()` (global broadcast) with targeted room or user-specific emissions

### Phase 6 — Automated Testing
- Add `jest`, `supertest`, `@faker-js/faker`
- Unit tests: controllers, models, middleware, utils
- Integration tests: full booking lifecycle, auth flows, role enforcement
- Concurrency test: parallel booking acceptance
- Socket.IO tests

### Phase 7 — README and API Documentation
- Add OpenAPI 3.0 spec (`swagger-jsdoc` + `swagger-ui-express`)
- Update README with setup, Docker instructions, and test commands

### Phase 8 — Docker and CI/CD
- Add `Dockerfile` (multi-stage)
- Add `docker-compose.yml` (app + MongoDB)
- Add GitHub Actions workflow: lint → test → build

### Phase 9 — Observability and Performance Testing
- Structured logging (`winston` or `pino`) replacing `console.log`
- Health check endpoint (`GET /health`)
- Load testing with `k6` or `artillery` (focus on booking acceptance concurrency)

### Phase 10 — Final Engineering Review
- Dependency vulnerability audit (`npm audit`)
- Review all TODO/FIXME comments
- Performance profiling of geospatial queries
- Final README pass

---

## 13. Dependencies Between Phases

```
Phase 1 (Security) → required by ALL subsequent phases
Phase 2 (Business Rules) → required before Phase 3 (safe to dispatch correctly)
Phase 3 (Dispatch) → can run in parallel with Phase 4
Phase 4 (DB/Audit) → independent; can start after Phase 1
Phase 5 (Real-time) → requires Phase 1 (socket auth) and Phase 3 (dispatch IDs)
Phase 6 (Tests) → should start after Phase 1; grows with each subsequent phase
Phase 7 (Docs) → can run any time; best done incrementally alongside feature phases
Phase 8 (Docker/CI) → best after Phase 6 (tests must pass in CI)
Phase 9 (Observability) → independent; add structured logging early in Phase 1
Phase 10 (Review) → terminal
```

---

## 14. Risks, Assumptions, and Limitations

### Risks
- **Data inconsistency in existing DB records** — Drivers registered via different code paths may have missing or inconsistent fields. Migrations may be needed before applying schema fixes.
- **Driver password in two collections** — If `Driver.password` and `User.password` differ, authentication will break silently when the schema is cleaned up.
- **`[0, 0]` drivers in production** — Any geospatial queries run now may return drivers whose real location is unknown.

### Assumptions
- The application is not deployed to production; it is in active local development.
- MongoDB is running locally or on Atlas during development.
- No other branches or feature branches exist (only `origin/main` was found).

### Limitations of this Audit
- **No runtime execution** — No requests were sent to the running server; all findings are static analysis.
- **No database inspection** — Actual data records and index states could not be verified.
- **`npm audit` could not run** — Sandbox has no network access; dependency vulnerabilities were not enumerated. Run `npm audit` manually before Phase 1.
- **EJS templates not fully inspected** — XSS risks in template rendering were not fully evaluated.
- **Load/performance testing not performed.**

---

## 15. Commands and Checks Performed

```powershell
# Git state
git status
git log --oneline -15
git branch -a
git remote -v
git diff HEAD -- README.md src/app.js

# Repository structure
Get-ChildItem -Recurse -Force -Name | Where-Object { $_ -notmatch 'node_modules' -and $_ -notmatch '\.git' }

# Files inspected (read, not modified)
package.json
.gitignore
.env.example
src/app.js
src/controllers/authController.js
src/controllers/bookingController.js
src/controllers/driverController.js
src/controllers/hospitalController.js
src/middleware/auth.js
src/middleware/authMiddleware.js
src/models/Booking.js
src/models/Driver.js
src/models/DriverStatus.js
src/models/Hospital.js
src/models/User.js
src/routes/auth.js
src/routes/booking.js
src/routes/driver.js
src/routes/hospital.js
src/routes/user.js
src/utils/catchAsync.js
src/utils/socketService.js
src/config/socket.js
src/config/i18n.js

# Test files check
Get-ChildItem -Recurse -Filter "*.test.js" -Name
Get-ChildItem -Recurse -Filter "*.spec.js" -Name

# CI/Docker check
Test-Path "docker-compose.yml"; Test-Path "Dockerfile"; Test-Path ".github"
```

### Checks That Could Not Be Performed
- `npm audit` — no network access in sandbox
- Runtime server behaviour (no MongoDB available)
- EJS template XSS analysis (templates not inspected)
- Actual database index verification
- Load/concurrency testing

---

## 16. Git Status Confirmation

At the time of this audit, the following uncommitted changes exist:

| File | Status | Description |
|---|---|---|
| `README.md` | Modified (not staged) | Substantially improved documentation (user-written) |
| `src/app.js` | Modified (not staged) | Debug route `/debug-session` removed (user-written improvement) |
| `.env.example` | Untracked | Environment variable template (user-written) |
| `docs/engineering/INITIAL_AUDIT.md` | **New (untracked)** | This audit report (only change from this task) |

> [!IMPORTANT]
> All three pre-existing user changes (`README.md`, `src/app.js`, `.env.example`) are **preserved and unmodified**. The only file created by this audit is `docs/engineering/INITIAL_AUDIT.md`.

No commits were made. No application code was modified. No dependencies were installed.


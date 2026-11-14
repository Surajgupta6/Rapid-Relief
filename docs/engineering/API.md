# Rapid Relief — API Reference

> **Base URL:** `http://localhost:3000` (development)  
> **Auth:** All protected routes require a valid `connect.sid` session cookie set by `/auth/login` or `/hospital/login`.  
> **Content-Type:** `application/json` for request bodies; `text/html` for page-render routes (marked **View**).

---

## Table of Contents

1. [Auth — `/auth`](#1-auth)
2. [Bookings — `/booking`](#2-bookings)
3. [Driver — `/driver`](#3-driver)
4. [Hospital — `/hospital`](#4-hospital)
5. [Admin — `/admin`](#5-admin)
6. [User — `/user`](#6-user)
7. [Socket.IO Events](#7-socketio-events)
8. [Error Format](#8-error-format)

---

## 1. Auth

### POST `/auth/register`

Register a new patient account.

**Auth:** Public

**Request body:**
```json
{
  "name": "Priya Sharma",
  "email": "priya@example.com",
  "password": "secret123",
  "phone": "9876543210",
  "address": "12 MG Road, Bengaluru"
}
```

**Validation rules:**
- `name` — required, non-empty string
- `email` — required, valid email format
- `password` — required, minimum 8 characters

**Success `201`:**
```json
{
  "status": "success",
  "message": "Registration successful",
  "user": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "Priya Sharma",
    "email": "priya@example.com",
    "role": "user"
  }
}
```

**Error `400`** — validation failure:
```json
{
  "status": "error",
  "errors": [
    { "field": "email", "message": "Must be a valid email address" }
  ]
}
```

**Error `409`** — email already registered:
```json
{ "status": "error", "message": "Email already in use" }
```

---

### POST `/auth/register-driver`

Register a new driver. Drivers are linked to a hospital and start as unverified (`isVerified: false`). An admin must verify the driver before they appear in the dispatch pool.

**Auth:** Public

**Request body:**
```json
{
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "password": "secret123",
  "phone": "9123456789",
  "licenseNumber": "KA0320210012345",
  "vehicleType": "Advanced Life Support",
  "ambulanceRegistration": "KA-01-AB-1234",
  "hospitalId": "64f1a2b3c4d5e6f7a8b9c0d2"
}
```

**Validation rules:**
- `name`, `email`, `password` — same as `/auth/register`
- `licenseNumber`, `vehicleType`, `ambulanceRegistration`, `hospitalId` — required, non-empty

**Success `201`:**
```json
{
  "status": "success",
  "message": "Driver registered successfully. Awaiting admin verification.",
  "driver": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d3",
    "name": "Ravi Kumar",
    "isVerified": false
  }
}
```

---

### POST `/auth/login`

Log in as a patient or driver. Sets a `connect.sid` session cookie.

**Auth:** Public

**Request body:**
```json
{
  "email": "priya@example.com",
  "password": "secret123"
}
```

**Success `200`:**
```json
{
  "status": "success",
  "message": "Logged in successfully",
  "user": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "Priya Sharma",
    "role": "user"
  }
}
```

**Error `401`:**
```json
{ "status": "error", "message": "Invalid email or password" }
```

---

### GET `/auth/logout`

Destroy the current session.

**Auth:** Session (any role)

**Success `200`:**
```json
{ "status": "success", "message": "Logged out successfully" }
```

---

### GET `/auth/current-user`

Return the user object stored in the current session.

**Auth:** Session (any role)

**Success `200`:**
```json
{
  "status": "success",
  "user": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "Priya Sharma",
    "role": "user"
  }
}
```

**Error `401`** — not logged in:
```json
{ "status": "error", "message": "Not authenticated" }
```

---

## 2. Bookings

### POST `/booking/anonymous-request`

Emergency booking without an account. Accepts raw coordinates only.

**Auth:** Public  
**Rate limit:** 5 requests per hour per IP

**Request body:**
```json
{
  "coordinates": [77.5946, 12.9716]
}
```

`coordinates` is `[longitude, latitude]` (GeoJSON order).

**Validation rules:**
- `coordinates` — required, array of exactly 2 numbers, longitude ∈ [-180, 180], latitude ∈ [-90, 90]

**Success `201`:**
```json
{
  "status": "success",
  "message": "Emergency request received. Help is on the way.",
  "bookingId": "64f1a2b3c4d5e6f7a8b9c0d4"
}
```

**Socket event emitted:** `anonymousRequestAlert` → all drivers room

---

### POST `/booking`

Create a standard booking with patient and location details.

**Auth:** User (session required)

**Request body:**
```json
{
  "patientName": "Arjun Singh",
  "patientAge": 45,
  "patientCondition": "Chest pain",
  "pickupCoordinates": [77.5946, 12.9716],
  "dropCoordinates": [77.6033, 12.9784]
}
```

**Validation rules:**
- `patientName` — required
- `pickupCoordinates`, `dropCoordinates` — required, `[lng, lat]` arrays

**Success `201`:**
```json
{
  "status": "success",
  "booking": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
    "status": "pending",
    "patientName": "Arjun Singh",
    "fare": 185,
    "pickup": { "type": "Point", "coordinates": [77.5946, 12.9716] },
    "drop":   { "type": "Point", "coordinates": [77.6033, 12.9784] },
    "createdAt": "2026-11-14T10:00:00.000Z"
  }
}
```

**Socket event emitted:** `newBookingAlert` → drivers room

---

### GET `/booking/user`

List all bookings for the currently logged-in user.

**Auth:** User

**Success `200`:**
```json
{
  "status": "success",
  "bookings": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "status": "completed",
      "fare": 185,
      "driver": { "name": "Ravi Kumar", "vehicleNumber": "KA-01-AB-1234" },
      "createdAt": "2026-11-14T10:00:00.000Z"
    }
  ]
}
```

---

### GET `/booking/driver`

Returns the driver's own bookings plus all unassigned `pending` bookings (dispatch pool).

**Auth:** Driver

**Success `200`:**
```json
{
  "status": "success",
  "myBookings": [ /* driver's historical bookings */ ],
  "pendingBookings": [ /* unassigned pending bookings */ ]
}
```

---

### GET `/booking/driver/current`

Returns the driver's currently active booking (`accepted` or `inProgress`).

**Auth:** Driver

**Success `200`:**
```json
{
  "status": "success",
  "booking": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
    "status": "accepted",
    "patientName": "Arjun Singh",
    "pickup": { "type": "Point", "coordinates": [77.5946, 12.9716] }
  }
}
```

**Success `200`** — no active booking:
```json
{ "status": "success", "booking": null }
```

---

### POST `/booking/accept/:bookingId`

Accept a pending booking. Concurrency-safe: uses `findOneAndUpdate` with `__v` locking. Exactly one driver wins; all others receive `409`.

**Auth:** Driver (must be `isVerified: true`)

**URL param:** `bookingId` — MongoDB ObjectId

**Success `200`:**
```json
{
  "status": "success",
  "message": "Booking accepted",
  "booking": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
    "status": "accepted",
    "driver": "64f1a2b3c4d5e6f7a8b9c0d3"
  }
}
```

**Error `409`** — another driver accepted first:
```json
{ "status": "error", "message": "Booking already accepted by another driver" }
```

**Error `403`** — driver not verified:
```json
{ "status": "error", "message": "Your account is pending admin verification" }
```

**Socket events emitted:**
- `bookingAccepted` → `booking:<bookingId>` room (notifies patient)
- `driverAssigned` → `user:<userId>` room

---

### POST `/booking/decline/:bookingId`

Decline a booking. The driver's ID is added to `declinedBy` so they won't be shown the booking again.

**Auth:** Driver

**Success `200`:**
```json
{ "status": "success", "message": "Booking declined" }
```

---

### POST `/booking/:id/status`

Advance a booking's status. Valid transitions: `accepted → inProgress`, `inProgress → completed`.

**Auth:** Driver (must be the assigned driver for this booking)

**Request body:**
```json
{ "status": "inProgress" }
```

**Success `200`:**
```json
{
  "status": "success",
  "booking": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
    "status": "inProgress",
    "statusHistory": [
      { "status": "pending",    "changedAt": "2026-11-14T10:00:00Z", "changedBy": "system" },
      { "status": "accepted",   "changedAt": "2026-11-14T10:02:00Z", "changedBy": "driver" },
      { "status": "inProgress", "changedAt": "2026-11-14T10:15:00Z", "changedBy": "driver" }
    ]
  }
}
```

**Error `400`** — invalid transition:
```json
{ "status": "error", "message": "Cannot transition from accepted to completed directly" }
```

**Socket event emitted:** `bookingStatusUpdated` → `booking:<id>` room

---

### POST `/booking/:id/cancel`

Cancel a booking that is still `pending` or `accepted`.

**Auth:** User (booking owner) or Driver (assigned driver)

**Success `200`:**
```json
{ "status": "success", "message": "Booking cancelled" }
```

**Error `400`** — booking already in progress or completed:
```json
{ "status": "error", "message": "Cannot cancel a booking that is inProgress or completed" }
```

---

### POST `/booking/:id/rate`

Rate a completed booking. Can only be done once.

**Auth:** User (booking owner)

**Request body:**
```json
{ "rating": 4 }
```

`rating` must be an integer 1–5.

**Success `200`:**
```json
{
  "status": "success",
  "message": "Rating submitted",
  "driverRating": 4.3
}
```

**Error `400`** — booking not completed or already rated:
```json
{ "status": "error", "message": "Booking is not completed or has already been rated" }
```

---

## 3. Driver

### GET `/driver/dashboard`

**Auth:** Driver  
**Response:** View (renders `views/driver/dashboard.ejs`)

---

### GET `/driver/profile`

Return the logged-in driver's profile.

**Auth:** Driver

**Success `200`:**
```json
{
  "status": "success",
  "driver": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
    "name": "Ravi Kumar",
    "licenseNumber": "KA0320210012345",
    "vehicleType": "Advanced Life Support",
    "ambulanceRegistration": "KA-01-AB-1234",
    "isAvailable": true,
    "isVerified": true,
    "rating": 4.3,
    "totalRatings": 12,
    "location": { "type": "Point", "coordinates": [77.5946, 12.9716] }
  }
}
```

---

### PUT `/driver/profile`

Update driver profile and ambulance details.

**Auth:** Driver

**Request body** (all fields optional):
```json
{
  "vehicleType": "Basic Life Support",
  "ambulanceRegistration": "KA-01-CD-5678"
}
```

**Success `200`:**
```json
{ "status": "success", "message": "Profile updated", "driver": { /* updated driver */ } }
```

---

### PUT `/driver/location`

Save the driver's current GPS coordinates. Called every 10 seconds by the driver dashboard.

**Auth:** Driver

**Request body:**
```json
{
  "longitude": 77.5946,
  "latitude": 12.9716
}
```

**Success `200`:**
```json
{ "status": "success", "message": "Location updated" }
```

**Socket event emitted:** `driverLocationUpdate` → `booking:<currentBookingId>` room (includes ETA estimate)

---

### GET `/driver/nearby`

Find other drivers within a radius using MongoDB `$near`.

**Auth:** Driver

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `longitude` | number | — | Reference point longitude |
| `latitude` | number | — | Reference point latitude |
| `maxDistance` | number | 5000 | Radius in metres |

**Success `200`:**
```json
{
  "status": "success",
  "drivers": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d9",
      "name": "Amit Verma",
      "isAvailable": true,
      "location": { "type": "Point", "coordinates": [77.591, 12.974] }
    }
  ]
}
```

---

### GET `/driver/bookings`

Driver's full booking history.

**Auth:** Driver

**Success `200`:**
```json
{
  "status": "success",
  "bookings": [ /* array of Booking documents */ ]
}
```

---

## 4. Hospital

### POST `/hospital/register`

Register a new hospital.

**Auth:** Public

**Request body:**
```json
{
  "name": "City General Hospital",
  "email": "admin@cityhospital.com",
  "password": "secure456",
  "contactNumber": "08012345678",
  "address": "1 Hospital Road, Bengaluru",
  "licenseNumber": "KA-HOSP-2021-001",
  "generalWard":          { "capacity": 100, "availableBeds": 72 },
  "opd":                  { "capacity": 50,  "availableBeds": 30 },
  "emergencyDepartment":  { "capacity": 20,  "availableBeds": 8  },
  "location": { "type": "Point", "coordinates": [77.5946, 12.9716] }
}
```

**Success `201`:**
```json
{
  "status": "success",
  "message": "Hospital registered successfully",
  "hospital": { "_id": "...", "name": "City General Hospital" }
}
```

---

### POST `/hospital/login`

Hospital login. Sets session with `role: 'hospital'`.

**Auth:** Public

**Request body:**
```json
{
  "email": "admin@cityhospital.com",
  "password": "secure456"
}
```

**Success `200`:**
```json
{ "status": "success", "message": "Login successful" }
```

---

### GET `/hospital/dashboard`

**Auth:** Hospital  
**Response:** View (renders `views/hospital/dashboard.ejs`)

---

### PATCH `/hospital/update-beds`

Update available bed counts for one or more wards.

**Auth:** Hospital

**Request body** (all ward fields optional):
```json
{
  "generalWard":         { "availableBeds": 68 },
  "opd":                 { "availableBeds": 25 },
  "emergencyDepartment": { "availableBeds": 5  }
}
```

**Success `200`:**
```json
{ "status": "success", "message": "Bed availability updated" }
```

---

### GET `/hospital/ambulance-locations`

Return current GPS coordinates for all drivers linked to this hospital.

**Auth:** Hospital

**Success `200`:**
```json
{
  "status": "success",
  "drivers": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
      "name": "Ravi Kumar",
      "isAvailable": true,
      "location": { "type": "Point", "coordinates": [77.5946, 12.9716] }
    }
  ]
}
```

---

### PATCH `/hospital/update-location`

Update the hospital's own GPS coordinates.

**Auth:** Hospital

**Request body:**
```json
{
  "longitude": 77.5946,
  "latitude": 12.9716
}
```

**Success `200`:**
```json
{ "status": "success", "message": "Location updated" }
```

---

## 5. Admin

All admin routes require a session with `role: 'admin'`. Returns `401` if unauthenticated, `403` if wrong role.

### GET `/admin/stats`

Platform-wide statistics.

**Auth:** Admin

**Success `200`:**
```json
{
  "status": "success",
  "stats": {
    "totalUsers": 142,
    "totalDrivers": 38,
    "verifiedDrivers": 31,
    "totalHospitals": 7,
    "totalBookings": 519,
    "pendingBookings": 4,
    "completedBookings": 487
  }
}
```

---

### GET `/admin/drivers`

List all drivers with verification and availability status.

**Auth:** Admin

**Success `200`:**
```json
{
  "status": "success",
  "drivers": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
      "name": "Ravi Kumar",
      "isVerified": false,
      "isAvailable": true,
      "hospital": { "name": "City General Hospital" }
    }
  ]
}
```

---

### GET `/admin/drivers/stale`

List drivers whose `locationSetAt` is older than 24 hours (not seen recently).

**Auth:** Admin

**Success `200`:**
```json
{
  "status": "success",
  "staleDrivers": [ /* array of Driver documents */ ]
}
```

---

### POST `/admin/drivers/:driverId/verify`

Mark a driver as verified. They will now appear in the dispatch pool.

**Auth:** Admin

**Success `200`:**
```json
{ "status": "success", "message": "Driver verified successfully" }
```

**Error `404`:**
```json
{ "status": "error", "message": "Driver not found" }
```

---

### POST `/admin/drivers/:driverId/revoke`

Revoke a driver's verification. They are removed from the dispatch pool immediately.

**Auth:** Admin

**Success `200`:**
```json
{ "status": "success", "message": "Driver verification revoked" }
```

---

### GET `/admin/bookings/stale`

List bookings stuck in `pending` or `accepted` for more than 2 hours.

**Auth:** Admin

**Success `200`:**
```json
{
  "status": "success",
  "staleBookings": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "status": "pending",
      "createdAt": "2026-11-14T07:30:00.000Z",
      "patientName": "Unknown"
    }
  ]
}
```

---

### POST `/admin/bookings/:bookingId/force-cancel`

Force-cancel a stale booking regardless of its current status.

**Auth:** Admin

**Success `200`:**
```json
{ "status": "success", "message": "Booking force-cancelled" }
```

---

## 6. User

### GET `/user/dashboard`

**Auth:** User  
**Response:** View (renders `views/user/dashboard.ejs`)

---

### GET `/user/profile`

**Auth:** User  
**Response:** View (renders `views/user/profile.ejs`)

---

### GET `/user/bookings`

**Auth:** User  
**Response:** View (renders `views/user/bookings.ejs`)

---

### POST `/user/update-profile`

Update the logged-in user's name, phone, address, or password.

**Auth:** User

**Request body** (all fields optional):
```json
{
  "name": "Priya S.",
  "phone": "9876543210",
  "address": "45 Park Avenue, Bengaluru",
  "currentPassword": "secret123",
  "newPassword": "newSecret456"
}
```

Password change is only processed if **both** `currentPassword` and `newPassword` are supplied. `newPassword` must be at least 8 characters.

**Success `200`:**
```json
{ "status": "success", "message": "Profile updated successfully" }
```

**Error `400`** — wrong current password:
```json
{ "status": "error", "message": "Current password is incorrect" }
```

---

## 7. Socket.IO Events

Connect to the same origin as the HTTP server. Auth is validated server-side by checking the session cookie on the socket handshake.

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `joinRoom` | `{ room: "drivers" \| "user:<id>" \| "booking:<id>" \| "hospital:<id>" }` | Join a named room to receive targeted events |
| `leaveRoom` | `{ room: "..." }` | Leave a room |

### Server → Client

| Event | Room | Payload | Trigger |
|---|---|---|---|
| `newBookingAlert` | `drivers` | `{ booking }` | New standard booking created |
| `anonymousRequestAlert` | `drivers` | `{ booking }` | Anonymous emergency request received |
| `bookingAccepted` | `booking:<id>` | `{ bookingId, driverId }` | Driver accepted the booking |
| `driverAssigned` | `user:<id>` | `{ bookingId, driver }` | Same as above, targeted to patient |
| `driverLocationUpdate` | `booking:<id>` | `{ coordinates, eta }` | Driver sent a location update |
| `bookingStatusUpdated` | `booking:<id>` | `{ bookingId, status }` | Status transitioned (inProgress, completed) |
| `bookingCancelled` | `booking:<id>` | `{ bookingId }` | Booking was cancelled |

> All server-emitted events include a `_sentAt` ISO timestamp field injected by the `notify()` helper.

---

## 8. Error Format

All API error responses follow this shape:

```json
{
  "status": "error",
  "message": "Human-readable error description"
}
```

Validation errors (HTTP `400`) include a field-level `errors` array:

```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [
    { "field": "email",    "message": "Must be a valid email address" },
    { "field": "password", "message": "Must be at least 8 characters" }
  ]
}
```

In `production` mode (`NODE_ENV=production`) internal error details and stack traces are suppressed.

### HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request — validation failure or invalid state transition |
| 401 | Unauthorized — no active session |
| 403 | Forbidden — wrong role or account not verified |
| 404 | Not Found |
| 409 | Conflict — concurrency conflict (e.g. booking already accepted) |
| 429 | Too Many Requests — rate limit exceeded |
| 500 | Internal Server Error |

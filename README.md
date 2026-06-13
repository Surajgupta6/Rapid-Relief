# RAPID RELIEF

A real-time emergency medical service system built with Node.js, Express, MongoDB, and Socket.io. This application provides GPS tracking for ambulances, user and driver interfaces, and a booking system for emergency medical services.

## Features

- Real-time GPS tracking of ambulances
- User interface for booking ambulances
- Driver interface for managing bookings and updating location
- Responsive design for mobile and desktop
- Authentication and user management
- Real-time notifications and updates using Socket.io
- MongoDB database integration

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or Atlas)
- npm or yarn package manager

## Installation

1. Clone the repository:
```
git clone https://github.com/yourusername/ambulance-tracker.git
cd ambulance-tracker
```

2. Install dependencies:
```
npm install
```

3. Create a `.env` file in the root directory with the following environment variables:
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/ambulance-tracker
SESSION_SECRET=your_secret_key_here
NODE_ENV=development
```

## Running the Application

1. Start MongoDB service (if using local MongoDB):
```
mongod
```

2. Start the application:
```
npm start
```

For development with auto-restart:
```
npm run dev
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Project Structure

```
ambulance-tracker/
├── src/
│   ├── controllers/    # Route controllers
│   ├── models/         # Database models
│   ├── routes/         # Express routes
│   ├── middleware/     # Express middleware
│   ├── views/          # EJS templates
│   ├── public/         # Static assets
│   │   ├── css/
│   │   ├── js/
│   │   └── images/
│   └── app.js          # Main application file
├── .env                # Environment variables
├── package.json
└── README.md
```

## Usage

### User Interface

1. Register or log in as a user
2. Book an ambulance by providing:
   - Patient details
   - Pickup location (can be selected on map)
   - Destination 
   - Medical condition
3. Track the ambulance in real-time
4. View booking history and status

### Driver Interface

1. Register or log in as a driver
2. Update availability status
3. View and accept booking requests
4. Start GPS tracking
5. Navigate to pickup and drop locations
6. Update booking status (accepted, in progress, completed)

## Technologies Used

- **Backend**: Node.js, Express
- **Database**: MongoDB with Mongoose
- **Real-time Communication**: Socket.io
- **Authentication**: Express-session, bcrypt
- **Frontend**: EJS, Bootstrap 5, Leaflet.js (maps)
- **Geolocation**: HTML5 Geolocation API, OpenStreetMap

## Acknowledgements

- [OpenStreetMap](https://www.openstreetmap.org/) for the map tiles
- [Leaflet.js](https://leafletjs.com/) for the interactive maps
- [Socket.io](https://socket.io/) for real-time communication
- [Bootstrap](https://getbootstrap.com/) for the UI components 

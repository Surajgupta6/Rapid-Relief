import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';

const BookingTab = ({ driverId }) => {
  const [bookings, setBookings] = useState([]);
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io(process.env.REACT_APP_API_URL || 'http://localhost:5000', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5
    });

    // Socket connection event handlers
    newSocket.on('connect', () => {
      console.log('Socket connected successfully');
      setConnected(true);
      
      // Authenticate as driver
      newSocket.emit('authenticate', { userId: driverId, role: 'driver' });
      console.log('Driver authentication sent:', { userId: driverId, role: 'driver' });
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setError('Connection error. Please refresh the page.');
    });

    setSocket(newSocket);

    // Fetch existing bookings
    fetchBookings();

    // Listen for new bookings
    newSocket.on('newBookingAlert', (booking) => {
      console.log('New booking received:', booking);
      setBookings(prev => {
        // Check if booking already exists
        const exists = prev.some(b => b._id === booking._id);
        if (exists) {
          return prev;
        }
        return [booking, ...prev];
      });
    });

    // Listen for booking updates
    newSocket.on('bookingUpdate', ({ bookingId, status }) => {
      console.log('Booking update received:', { bookingId, status });
      setBookings(prev => prev.map(booking => 
        booking._id === bookingId 
          ? { ...booking, status } 
          : booking
      ));
    });

    return () => {
      if (newSocket) {
        console.log('Disconnecting socket');
        newSocket.disconnect();
      }
    };
  }, [driverId]);

  const fetchBookings = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/bookings/driver');
      console.log('Fetched bookings:', response.data.data.bookings);
      setBookings(response.data.data.bookings);
      setError(null);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      setError('Failed to load bookings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptBooking = async (bookingId) => {
    try {
      await axios.post(`/api/bookings/${bookingId}/accept`);
      if (socket && socket.connected) {
        socket.emit('bookingStatusUpdate', {
          bookingId,
          status: 'accepted',
          driverId
        });
      } else {
        console.error('Socket not connected while accepting booking');
        setError('Connection error. Please refresh the page.');
      }
    } catch (err) {
      console.error('Error accepting booking:', err);
      setError('Failed to accept booking. Please try again.');
    }
  };

  const handleDeclineBooking = async (bookingId) => {
    try {
      await axios.post(`/api/bookings/${bookingId}/decline`);
      if (socket && socket.connected) {
        socket.emit('bookingStatusUpdate', {
          bookingId,
          status: 'declined',
          driverId
        });
      } else {
        console.error('Socket not connected while declining booking');
        setError('Connection error. Please refresh the page.');
      }
    } catch (err) {
      console.error('Error declining booking:', err);
      setError('Failed to decline booking. Please try again.');
    }
  };

  if (loading) return <div className="loading">Loading bookings...</div>;

  return (
    <div className="booking-tab">
      <div className="booking-tab-header">
        <h2>Available Bookings</h2>
        <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>
      
      {error && <div className="error">{error}</div>}
      
      <div className="bookings-list">
        {bookings.map(booking => (
          <div key={booking._id} className={`booking-card ${booking.status}`}>
            <div className="booking-header">
              <h3>Patient: {booking.patientName}</h3>
              <span className="status">{booking.status}</span>
            </div>
            <div className="booking-details">
              <p><strong>From:</strong> {booking.pickupLocation.address}</p>
              <p><strong>To:</strong> {booking.dropLocation.address}</p>
              <p><strong>Medical Condition:</strong> {booking.medicalCondition}</p>
              <p><strong>Contact:</strong> {booking.patientContact}</p>
              <p><strong>Fare:</strong> ₹{booking.fare}</p>
              <p><strong>Scheduled:</strong> {new Date(booking.scheduledTime).toLocaleString()}</p>
            </div>
            {booking.status === 'pending' && (
              <div className="booking-actions">
                <button 
                  className="accept-btn"
                  onClick={() => handleAcceptBooking(booking._id)}
                >
                  Accept
                </button>
                <button 
                  className="decline-btn"
                  onClick={() => handleDeclineBooking(booking._id)}
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        ))}
        {bookings.length === 0 && (
          <div className="no-bookings">
            No bookings available at the moment
          </div>
        )}
      </div>
    </div>
  );
};

export default BookingTab; 
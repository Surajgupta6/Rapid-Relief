/**
 * Main JavaScript for Rapid Relief
 */

// Initialize socket connection
const socket = io();

// Common functions
function initializeSocket(type, id) {
  socket.emit('register', { type, id });
}

// Client-side functions
const clientFunctions = {
  initializeBooking: function() {
    const bookingForm = document.getElementById('bookingForm');
    if (!bookingForm) return;

    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(bookingForm);
      const bookingData = Object.fromEntries(formData.entries());
      
      try {
        const response = await fetch('/booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bookingData)
        });
        
        const result = await response.json();
        if (result.status === 'success') {
          socket.emit('newBooking', result.data.booking);
          updateBookingStatus('Searching for driver...');
        }
      } catch (error) {
        console.error('Booking error:', error);
      }
    });
  },

  initializeTracking: function() {
    const map = document.getElementById('map');
    if (!map) return;

    // Handle driver acceptance
    socket.on('bookingAccepted', (data) => {
      updateBookingStatus('Driver assigned');
      showDriverInfo(data);
    });

    // Handle location updates
    socket.on('driverLocationUpdate', (data) => {
      updateDriverLocation(data.location);
      updateETA(data.location);
    });

    // Handle status updates
    socket.on('bookingStatusUpdated', (data) => {
      updateBookingStatus(data.status);
      if (data.status === 'completed') {
        showRatingPrompt();
      }
    });
  }
};

// Driver-side functions
const driverFunctions = {
  initializeDriver: function() {
    if (!document.getElementById('driverDashboard')) return;

    // Update availability status
    const availabilityToggle = document.getElementById('availabilityToggle');
    if (availabilityToggle) {
      availabilityToggle.addEventListener('change', (e) => {
        socket.emit('driverAvailabilityUpdate', {
          driverId: currentDriver.id,
          isAvailable: e.target.checked
        });
      });
    }

    // Handle new booking requests
    socket.on('newBookingRequest', (booking) => {
      showBookingRequest(booking);
    });

    // Start location tracking if on duty
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          
          if (currentBooking) {
            socket.emit('updateDriverLocation', {
              driverId: currentDriver.id,
              bookingId: currentBooking.id,
              location
            });
          }
        },
        (error) => console.error('Geolocation error:', error),
        { enableHighAccuracy: true }
      );
    }
  },

  acceptBooking: function(bookingId) {
    fetch(`/booking/accept/${bookingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(result => {
      if (result.status === 'success') {
        socket.emit('bookingAccepted', {
          bookingId,
          driverId: currentDriver.id,
          driverName: currentDriver.name,
          vehicleInfo: currentDriver.vehicle
        });
        initializeTrip(result.data.booking);
      }
    })
    .catch(error => console.error('Error accepting booking:', error));
  },

  updateBookingStatus: function(bookingId, status) {
    fetch(`/booking/${bookingId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
    .then(async response => {
      if (!response.ok) {
        // If response is not OK, try to read error message from body or throw a generic error
        const errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          throw new Error(errorJson.message || `API error: ${response.status}`);
        } catch (e) {
          // If parsing as JSON fails, the response was likely HTML or plain text
           throw new Error(`HTTP error ${response.status}: ${response.statusText}. Response body: ${errorText.substring(0, 100)}...`);
        }
      }
      return response.json();
    })
    .then(result => {
      if (result.status === 'success') {
        console.log(`Booking ${bookingId} status updated to ${status}`);
        // Emit socket event only on success
        socket.emit('bookingStatusUpdate', {
          bookingId,
          status,
          driverId: currentDriver.id
        });
        // Optionally trigger UI update for the specific booking card
        // updateBookingCardStatus(bookingId, status);
      } else {
        // Handle application-level errors returned in JSON with status: 'error'
        throw new Error(result.message || 'Failed to update status');
      }
    })
    .catch(error => {
      console.error('Error updating booking status:', error);
      // Display a user-friendly error message in the UI
      alert(`Failed to update booking status: ${error.message}`);
    });
  }
};

// Initialize based on page type
document.addEventListener('DOMContentLoaded', () => {
  // Check if user is logged in and get type
  fetch('/auth/current-user')
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        const { user } = data.data;
        initializeSocket(user.role, user.id);
        
        if (user.role === 'driver') {
          driverFunctions.initializeDriver();
        } else {
          clientFunctions.initializeBooking();
          clientFunctions.initializeTracking();
        }
      }
    })
    .catch(error => console.error('Error initializing:', error));
});

document.addEventListener('DOMContentLoaded', function() {
  // Initialize Socket.io connection if available
  let socket;
  try {
    socket = io();
    console.log('Socket connection established');
    
    // Listen for location updates
    socket.on('locationUpdate', function(data) {
      console.log('Location update received:', data);
      updateAmbulanceLocation(data);
    });
    
    // Connection event handlers
    socket.on('connect', function() {
      console.log('Connected to server');
    });
    
    socket.on('disconnect', function() {
      console.log('Disconnected from server');
    });
  } catch (e) {
    console.log('Socket.io not available or not needed on this page');
  }
  
  // Update ambulance location on map (if map exists)
  function updateAmbulanceLocation(data) {
    const map = window.map; // Map should be globally accessible
    if (!map) return;
    
    const { driverId, coordinates } = data;
    console.log(`Updating location for driver ${driverId} to ${coordinates}`);
    
    // If we're tracking a specific driver and this update is for a different driver, ignore it
    const currentDriverId = document.getElementById('currentDriverId')?.value;
    if (currentDriverId && currentDriverId !== driverId) return;
    
    // Update the marker on the map
    if (window.driverMarker) {
      // Update existing marker
      window.driverMarker.setLatLng([coordinates[1], coordinates[0]]);
    } else if (typeof L !== 'undefined') {
      // Create new marker if it doesn't exist
      const driverIcon = L.divIcon({
        html: '<i class="fas fa-ambulance fa-2x text-danger"></i>',
        className: 'driver-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      
      window.driverMarker = L.marker([coordinates[1], coordinates[0]], { icon: driverIcon }).addTo(map);
    }
    
    // Update ETA if element exists
    const etaElement = document.getElementById('estimatedTime');
    if (etaElement) {
      // In a real app, calculate ETA based on distance and traffic
      // For demo, we'll just update with a countdown
      const eta = parseInt(etaElement.dataset.eta || 5);
      if (eta > 1) {
        etaElement.textContent = `${eta - 1} minutes`;
        etaElement.dataset.eta = eta - 1;
      } else {
        etaElement.textContent = 'Less than a minute';
      }
    }
  }
  
  // Initialize any booking forms
  const bookingForm = document.getElementById('bookingForm');
  if (bookingForm) {
    bookingForm.addEventListener('submit', function(e) {
      // Form submission is handled in the specific page JavaScript
      // This is just a placeholder for any global form handling
    });
  }
  
  // Initialize modals if any
  const modals = document.querySelectorAll('.modal');
  if (modals.length > 0 && typeof bootstrap !== 'undefined') {
    modals.forEach(modalElement => {
      const modal = new bootstrap.Modal(modalElement);
      
      // Example: Auto show modal with 'auto-show' class
      if (modalElement.classList.contains('auto-show')) {
        modal.show();
      }
    });
  }
  
  // Mobile menu toggle - ensure proper Bootstrap version
  const navbarToggler = document.querySelector('.navbar-toggler');
  if (navbarToggler) {
    navbarToggler.addEventListener('click', function() {
      const targetId = this.getAttribute('data-bs-target') || this.getAttribute('data-target');
      const targetElement = document.querySelector(targetId);
      
      if (targetElement) {
        if (typeof bootstrap !== 'undefined') {
          // Bootstrap 5
          const bsCollapse = new bootstrap.Collapse(targetElement);
          bsCollapse.toggle();
        } else {
          // Fallback for Bootstrap 4 or manual toggle
          targetElement.classList.toggle('show');
        }
      }
    });
  }
  
  // Initialize tooltips
  if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip !== 'undefined') {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function(tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  }
  
  // Smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      
      if (href !== '#') {
        e.preventDefault();
        
        const targetElement = document.querySelector(href);
        if (targetElement) {
          targetElement.scrollIntoView({
            behavior: 'smooth'
          });
        }
      }
    });
  });
  
  // Geolocation utility function
  window.getLocation = function(successCallback, errorCallback) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude } = position.coords;
          successCallback({ latitude, longitude });
        },
        error => {
          console.error('Error getting location:', error);
          if (errorCallback) errorCallback(error);
        },
        { enableHighAccuracy: true }
      );
    } else {
      const error = new Error('Geolocation is not supported by this browser');
      console.error(error);
      if (errorCallback) errorCallback(error);
    }
  };
}); 
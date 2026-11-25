const Hospital = require('../models/Hospital');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const catchAsync = require('../utils/catchAsync');

// Get registration page
exports.getRegisterPage = async (req, res) => {
    res.render('auth/hospital/register', { error: null });
};

// Register hospital
exports.register = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            confirmPassword,
            contactNumber,
            address,
            licenseNumber,
            generalWard,
            opd,
            emergencyDepartment,
            location
        } = req.body;

        if (password !== confirmPassword) {
            return res.render('auth/hospital/register', {
                error: 'Passwords do not match'
            });
        }

        const existingHospital = await Hospital.findOne({
            $or: [{ email }, { licenseNumber }]
        });
        if (existingHospital) {
            return res.render('auth/hospital/register', {
                error: existingHospital.email === email
                    ? 'A hospital with this email already exists'
                    : 'A hospital with this license number already exists'
            });
        }

        const hospital = new Hospital({
            name,
            email,
            password,
            contactNumber,
            address,
            licenseNumber,
            generalWard: {
                capacity: parseInt(generalWard.capacity),
                availableBeds: parseInt(generalWard.availableBeds)
            },
            opd: {
                capacity: parseInt(opd.capacity),
                availableBeds: parseInt(opd.availableBeds)
            },
            emergencyDepartment: {
                capacity: parseInt(emergencyDepartment.capacity),
                availableBeds: parseInt(emergencyDepartment.availableBeds)
            },
            location: {
                type: 'Point',
                coordinates: [0, 0]
            }
        });

        await hospital.save();
        res.redirect('/hospital/login');
    } catch (error) {
        console.error('Hospital registration error:', error);
        res.render('auth/hospital/register', {
            error: 'An error occurred during registration'
        });
    }
};

// Get login page
exports.getLoginPage = async (req, res) => {
    res.render('auth/hospital/login', { error: null });
};

// Login hospital
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const hospital = await Hospital.findOne({ email }).select('+password');
        if (!hospital) {
            return res.render('auth/hospital/login', { error: 'Invalid email or password' });
        }

        const isPasswordValid = await hospital.correctPassword(password);
        if (!isPasswordValid) {
            return res.render('auth/hospital/login', { error: 'Invalid email or password' });
        }

        req.session.user = {
            id: hospital._id,
            name: hospital.name,
            email: hospital.email,
            role: 'hospital'
        };

        res.redirect('/hospital/dashboard');
    } catch (error) {
        console.error('Hospital login error:', error);
        res.render('auth/hospital/login', { error: 'An error occurred during login' });
    }
};

// Logout hospital
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ status: 'error', message: 'Error logging out' });
        }
        res.redirect('/');
    });
};

// Get hospital dashboard
exports.getDashboard = catchAsync(async (req, res) => {
    const hospital = await Hospital.findById(req.session.user.id);

    const drivers = await Driver.find({ hospital: hospital._id });

    // Use type: 'anonymous' (stored field) instead of isAnonymous (was not
    // in the old schema and was silently dropped — fixed in Phase 2).
    const bookings = await Booking.find({
        $or: [
            {
                driver: { $in: drivers.map((d) => d._id) },
                status: { $in: ['accepted', 'inProgress', 'completed'] }
            },
            {
                type: 'anonymous',
                status: { $in: ['pending', 'accepted', 'inProgress'] }
            }
        ]
    })
    .populate('driver', 'name contactNumber vehicleNumber vehicleType')
    .populate('user', 'name contactNumber')
    .sort({ createdAt: -1 })
    .limit(10);

    res.render('hospital/dashboard', { hospital, drivers, bookings });
});

// Update bed availability
exports.updateBedAvailability = catchAsync(async (req, res) => {
    const { generalWard, opd, emergencyDepartment } = req.body;

    const hospital = await Hospital.findById(req.session.user.id);

    if (generalWard) hospital.generalWard.availableBeds = parseInt(generalWard.availableBeds);
    if (opd) hospital.opd.availableBeds = parseInt(opd.availableBeds);
    if (emergencyDepartment) hospital.emergencyDepartment.availableBeds = parseInt(emergencyDepartment.availableBeds);

    await hospital.save();

    res.status(200).json({ status: 'success', data: { hospital } });
});

// Get ambulance locations
exports.getAmbulanceLocations = catchAsync(async (req, res) => {
    const hospitalId = req.session.user.id;

    const drivers = await Driver.find({ hospital: hospitalId })
        .select('_id name vehicleNumber location locationSetAt');

    const ambulances = drivers.map((driver) => ({
        driverId: driver._id,
        name: driver.name,
        vehicleNumber: driver.vehicleNumber,
        coordinates: driver.location.coordinates,
        locationSetAt: driver.locationSetAt || null,
        hasLocation: driver.locationSetAt !== null
    }));

    res.json({ status: 'success', data: { ambulances } });
});

// Update hospital location
exports.updateLocation = catchAsync(async (req, res) => {
    const { coordinates } = req.body;
    const hospitalId = req.session.user.id;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
        return res.status(400).json({ status: 'error', message: 'Invalid coordinates' });
    }

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
        return res.status(404).json({ status: 'error', message: 'Hospital not found' });
    }

    hospital.location = { type: 'Point', coordinates };
    await hospital.save();

    res.status(200).json({ status: 'success', data: { hospital } });
});

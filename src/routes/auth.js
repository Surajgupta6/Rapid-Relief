const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

// User registration and login routes
router.post('/register', authController.register);
router.post('/register-driver', authController.registerDriver);
router.post('/login', authController.login);
router.get('/logout', authController.logout);
router.get('/current-user', authController.getCurrentUser);

module.exports = router; 
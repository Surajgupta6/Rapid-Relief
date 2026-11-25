const express = require('express');
const authController = require('../controllers/authController');
const {
  registerRules,
  loginRules,
  registerDriverRules,
  handleValidationErrors
} = require('../middleware/validate');

const router = express.Router();

// User registration and login routes
router.post('/register', ...registerRules, handleValidationErrors, authController.register);
router.post('/register-driver', ...registerDriverRules, handleValidationErrors, authController.registerDriver);
router.post('/login', ...loginRules, handleValidationErrors, authController.login);
router.get('/logout', authController.logout);
router.get('/current-user', authController.getCurrentUser);

module.exports = router;

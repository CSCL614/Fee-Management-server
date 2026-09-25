const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { login, refreshToken, getMe, logout } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Rate limiter for login: max 5 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/login', loginLimiter, login);
router.post('/refresh', refreshToken);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);

module.exports = router;

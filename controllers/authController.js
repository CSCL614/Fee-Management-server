const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createAuditLog } = require('../utils/helpers');

// Generate JWT tokens
const generateAccessToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '15m'
  });
};

const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d'
  });
};

const bcrypt = require('bcryptjs');
const AcademicYear = require('../models/AcademicYear');
const Setting = require('../models/Setting');
const FeeCategory = require('../models/FeeCategory');
const FeeStructure = require('../models/FeeStructure');
const Student = require('../models/Student');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');

// Auto seed default admin & accountant accounts if DB is empty
const ensureDefaultUsersExist = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const salt = await bcrypt.genSalt(12);

      await Setting.insertMany([
        { key: 'collegeName', value: 'Sri Vidya Degree College' },
        { key: 'collegeAddress', value: 'Kukatpally, Hyderabad, Telangana - 500072' },
        { key: 'allowAdvancePayment', value: false }
      ]);

      await AcademicYear.insertMany([
        { year: '2024-25', startDate: new Date('2024-06-01'), endDate: new Date('2025-05-31'), isCurrent: false, status: 'active' },
        { year: '2025-26', startDate: new Date('2025-06-01'), endDate: new Date('2026-05-31'), isCurrent: false, status: 'active' },
        { year: '2026-27', startDate: new Date('2026-06-01'), endDate: new Date('2027-05-31'), isCurrent: true, status: 'active' }
      ]);

      await User.insertMany([
        { userId: 'USR-0001', name: 'Dr. Ramesh Kumar', username: 'admin', password: await bcrypt.hash('admin123', salt), role: 'admin', status: 'active' },
        { userId: 'USR-0002', name: 'Suresh Reddy', username: 'suresh', password: await bcrypt.hash('acc123', salt), role: 'accountant', status: 'active' }
      ]);

      await FeeCategory.insertMany([
        { name: 'Tuition Fee', description: 'Annual tuition fee', isDefault: true, status: 'active' },
        { name: 'Admission Fee', description: 'One-time admission fee', isDefault: true, status: 'active' },
        { name: 'Examination Fee', description: 'Semester examination fee', isDefault: true, status: 'active' },
        { name: 'University Fee', description: 'University registration fee', isDefault: true, status: 'active' },
        { name: 'Laboratory Fee', description: 'Lab usage fee', isDefault: true, status: 'active' },
        { name: 'Library Fee', description: 'Library access fee', isDefault: true, status: 'active' }
      ]);
    }
  } catch (err) {
    console.error('Error auto-seeding default users:', err);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  try {
    await ensureDefaultUsersExist();
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password'
      });
    }

    const user = await User.findOne({ username: username.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Contact administrator.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    await createAuditLog({
      user: user._id,
      userName: user.name,
      userRole: user.role,
      action: 'Login',
      entity: 'User',
      entityId: user.userId,
      description: `${user.name} logged in`,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          userId: user.userId,
          name: user.name,
          username: user.username,
          role: user.role,
          status: user.status
        },
        accessToken
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
exports.refreshToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    const accessToken = generateAccessToken(user._id);

    res.json({
      success: true,
      data: { accessToken }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
  res.json({
    success: true,
    data: {
      _id: req.user._id,
      userId: req.user.userId,
      name: req.user.name,
      username: req.user.username,
      role: req.user.role,
      status: req.user.status
    }
  });
};

// @desc    Logout user
// @route   POST /api/auth/logout
exports.logout = async (req, res) => {
  res.cookie('refreshToken', '', {
    httpOnly: true,
    expires: new Date(0)
  });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

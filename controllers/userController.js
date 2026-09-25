const User = require('../models/User');
const { createAuditLog, generateId } = require('../utils/helpers');

// @desc    Get all users
// @route   GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create user
// @route   POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, username, password, role } = req.body;

    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    const userId = await generateId(User, 'USR', 'userId');

    const user = await User.create({
      userId,
      name,
      username: username.toLowerCase(),
      password,
      role
    });

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'User Created',
      entity: 'User',
      entityId: userId,
      description: `Created user ${name} (${role})`,
      newValue: { userId, name, username, role },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        username: user.username,
        role: user.role,
        status: user.status
      },
      message: 'User created successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
exports.updateUser = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.id });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const oldValue = { name: user.name, role: user.role, status: user.status };

    if (req.body.name) user.name = req.body.name;
    if (req.body.role) user.role = req.body.role;
    if (req.body.status) user.status = req.body.status;
    if (req.body.password) user.password = req.body.password;

    await user.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'User Updated',
      entity: 'User',
      entityId: user.userId,
      description: `Updated user ${user.name}`,
      oldValue,
      newValue: { name: user.name, role: user.role, status: user.status },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        username: user.username,
        role: user.role,
        status: user.status
      },
      message: 'User updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const mongoose = require('mongoose');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { createAuditLog, generateId } = require('../utils/helpers');

// @desc    Get all users
// @route   GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ isDeleted: { $ne: true } })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching users' });
  }
};

// @desc    Create user
// @route   POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, username, password, role, email, phone } = req.body;

    if (!name || !username || !password || !role) {
      return res.status(400).json({ success: false, message: 'Name, username, password, and role are required' });
    }

    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    const userId = await generateId(User, 'USR', 'userId');

    const user = await User.create({
      userId,
      name: name.trim(),
      username: username.toLowerCase().trim(),
      password,
      role,
      email: email ? email.trim().toLowerCase() : null,
      phone: phone ? phone.trim() : null,
      status: 'active'
    });

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'User Created',
      entity: 'User',
      entityId: userId,
      description: `Created user account ${name} (${role})`,
      newValue: { userId, name, username: username.toLowerCase(), role, email, phone },
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
        email: user.email,
        phone: user.phone,
        status: user.status
      },
      message: 'User created successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Server error creating user' });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
exports.updateUser = async (req, res) => {
  try {
    const isObjectId = mongoose.isValidObjectId(req.params.id);
    const user = await User.findOne({
      $or: [
        { userId: req.params.id },
        ...(isObjectId ? [{ _id: req.params.id }] : [])
      ]
    }).select('+password');

    if (!user || user.isDeleted) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Safety guard: prevent administrator from deactivating own account
    if (req.body.status === 'inactive') {
      if (req.user && req.user._id && user._id.toString() === req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'You cannot deactivate your own administrative account to prevent system lockout.'
        });
      }
      if (user.role === 'admin') {
        const activeAdmins = await User.countDocuments({
          role: 'admin',
          status: 'active',
          isDeleted: { $ne: true },
          _id: { $ne: user._id }
        });
        if (activeAdmins === 0) {
          return res.status(400).json({
            success: false,
            message: 'Cannot deactivate the only active administrator account.'
          });
        }
      }
    }

    // Guard against demoting the last active administrator
    if (req.body.role && req.body.role !== 'admin' && user.role === 'admin') {
      const activeAdmins = await User.countDocuments({
        role: 'admin',
        status: 'active',
        isDeleted: { $ne: true },
        _id: { $ne: user._id }
      });
      if (activeAdmins === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot change the role of the only active administrator account.'
        });
      }
    }

    const oldValue = {
      name: user.name,
      role: user.role,
      status: user.status,
      email: user.email,
      phone: user.phone
    };

    if (req.body.name) user.name = req.body.name.trim();
    if (req.body.role) user.role = req.body.role;
    if (req.body.status) user.status = req.body.status;
    if (req.body.email !== undefined) user.email = req.body.email ? req.body.email.trim().toLowerCase() : null;
    if (req.body.phone !== undefined) user.phone = req.body.phone ? req.body.phone.trim() : null;
    if (req.body.password && req.body.password.trim().length >= 6) {
      user.password = req.body.password.trim();
    }

    await user.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'User Updated',
      entity: 'User',
      entityId: user.userId,
      description: `Updated profile details for user ${user.name} (${user.role})`,
      oldValue,
      newValue: {
        name: user.name,
        role: user.role,
        status: user.status,
        email: user.email,
        phone: user.phone,
        passwordChanged: Boolean(req.body.password)
      },
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
        email: user.email,
        phone: user.phone,
        status: user.status
      },
      message: 'User account updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error updating user' });
  }
};

// @desc    Delete user (Admin only)
// @route   DELETE /api/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const isObjectId = mongoose.isValidObjectId(req.params.id);
    const user = await User.findOne({
      $or: [
        { userId: req.params.id },
        ...(isObjectId ? [{ _id: req.params.id }] : [])
      ]
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Safety guard: prevent administrator from deleting own account
    if (req.user && req.user._id && user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own administrative account.'
      });
    }

    // Guard against deleting the only active administrator
    if (user.role === 'admin') {
      const activeAdmins = await User.countDocuments({
        role: 'admin',
        status: 'active',
        isDeleted: { $ne: true },
        _id: { $ne: user._id }
      });
      if (activeAdmins === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the only remaining active administrator account.'
        });
      }
    }

    // Check if user has associated financial activity or transactions recorded
    const hasPayments = await Payment.exists({ enteredBy: user._id });

    if (hasPayments) {
      // Soft-delete to preserve audit logs and financial history
      user.isDeleted = true;
      user.status = 'inactive';
      user.deletedAt = new Date();
      user.deletedBy = req.user._id;
      await user.save();
    } else {
      // Hard delete if no financial records exist
      await User.deleteOne({ _id: user._id });
    }

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'User Deleted',
      entity: 'User',
      entityId: user.userId,
      description: `Deleted user ${user.name} (${user.username}, role: ${user.role}) - ${hasPayments ? 'Soft Deleted (Preserved Financial Logs)' : 'Permanently Removed'}`,
      oldValue: { userId: user.userId, name: user.name, username: user.username, role: user.role },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `User ${user.name} deleted successfully.`
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error deleting user' });
  }
};

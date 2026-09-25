const AuditLog = require('../models/AuditLog');
const AcademicYear = require('../models/AcademicYear');
const Setting = require('../models/Setting');

// @desc    Get audit logs
// @route   GET /api/audit
exports.getAuditLogs = async (req, res) => {
  try {
    const { action, entity, user, dateFrom, dateTo, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (action) filter.action = new RegExp(action, 'i');
    if (entity) filter.entity = entity;
    if (user) filter.userName = new RegExp(user, 'i');
    if (dateFrom || dateTo) {
      filter.timestamp = {};
      if (dateFrom) filter.timestamp.$gte = new Date(dateFrom);
      if (dateTo) filter.timestamp.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    const total = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: logs,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get academic years
// @route   GET /api/academic-years
exports.getAcademicYears = async (req, res) => {
  try {
    const years = await AcademicYear.find().sort({ year: -1 });
    res.json({ success: true, data: years });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create academic year
// @route   POST /api/academic-years
exports.createAcademicYear = async (req, res) => {
  try {
    const { year, startDate, endDate, isCurrent } = req.body;

    const existing = await AcademicYear.findOne({ year });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Academic year already exists' });
    }

    // If marking as current, unset all others
    if (isCurrent) {
      await AcademicYear.updateMany({}, { isCurrent: false });
    }

    const academicYear = await AcademicYear.create({ year, startDate, endDate, isCurrent });
    res.status(201).json({ success: true, data: academicYear, message: 'Academic year created' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get settings
// @route   GET /api/settings
exports.getSettings = async (req, res) => {
  try {
    const settings = await Setting.find();
    const settingsObj = {};
    settings.forEach(s => { settingsObj[s.key] = s.value; });
    res.json({ success: true, data: settingsObj });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update settings
// @route   PUT /api/settings
exports.updateSettings = async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await Setting.findOneAndUpdate(
        { key },
        { key, value },
        { upsert: true, new: true }
      );
    }
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

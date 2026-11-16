const AuditLog = require('../models/AuditLog');
const AcademicYear = require('../models/AcademicYear');
const Setting = require('../models/Setting');
const { createAuditLog } = require('../utils/helpers');

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

// ==============================================================
// REQUIREMENT 5: BRANCH & STUDY-YEAR-WISE ACADEMIC YEAR CONFIG
// ==============================================================

// @desc    Get academic years (with optional course and study year filters)
// @route   GET /api/audit/academic-years
exports.getAcademicYears = async (req, res) => {
  try {
    const { course, studyYear, status, year } = req.query;
    const filter = {};
    if (course && course !== 'All') {
      filter.$or = [{ course: course }, { course: 'All' }];
    }
    if (studyYear && studyYear !== 'All') {
      filter.$or = [{ studyYear: studyYear }, { studyYear: 'All' }];
    }
    if (status) filter.status = status;
    if (year) filter.year = year;

    const years = await AcademicYear.find(filter).sort({ year: -1, course: 1, studyYear: 1 });
    res.json({ success: true, data: years });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create academic year configuration (Course & Study Year specific)
// @route   POST /api/audit/academic-years
exports.createAcademicYear = async (req, res) => {
  try {
    const {
      year,
      course = 'All',
      studyYear = 'All',
      startDate,
      endDate,
      feeActivationDate,
      feeDueDate,
      isCurrent = false,
      status = 'active'
    } = req.body;

    if (!year || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Academic Year label, Start Date, and End Date are required.'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: 'Academic year Start Date must precede End Date.'
      });
    }

    const trimmedYear = year.trim();
    const trimmedCourse = (course || 'All').trim();
    const trimmedStudyYear = (studyYear || 'All').trim();

    // Check for duplicate configuration for the same course, study year, and academic year label
    const existing = await AcademicYear.findOne({
      year: trimmedYear,
      course: trimmedCourse,
      studyYear: trimmedStudyYear
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `An academic year configuration already exists for ${trimmedCourse} (${trimmedStudyYear}) - Session ${trimmedYear}.`
      });
    }

    // If marking as current for this course & study year, unset existing ones
    if (isCurrent) {
      await AcademicYear.updateMany(
        { course: trimmedCourse, studyYear: trimmedStudyYear },
        { isCurrent: false }
      );
    }

    const academicYear = await AcademicYear.create({
      year: trimmedYear,
      course: trimmedCourse,
      studyYear: trimmedStudyYear,
      startDate: start,
      endDate: end,
      feeActivationDate: feeActivationDate ? new Date(feeActivationDate) : null,
      feeDueDate: feeDueDate ? new Date(feeDueDate) : null,
      isCurrent: Boolean(isCurrent),
      status: status || 'active',
      createdBy: req.user?._id
    });

    // Audit log
    await createAuditLog({
      user: req.user?._id,
      userName: req.user?.name || 'Administrator',
      userRole: req.user?.role || 'admin',
      action: 'Academic Year Configured',
      entity: 'AcademicYear',
      entityId: academicYear._id.toString(),
      description: `Configured academic year ${trimmedYear} for ${trimmedCourse} (${trimmedStudyYear}): ${start.toLocaleDateString()} to ${end.toLocaleDateString()}`,
      newValue: academicYear.toObject(),
      reason: 'Course/Study-Year academic session configured',
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: academicYear,
      message: `Academic year ${trimmedYear} for ${trimmedCourse} (${trimmedStudyYear}) successfully created`
    });
  } catch (error) {
    console.error('Create academic year error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Update academic year configuration
// @route   PUT /api/audit/academic-years/:id
exports.updateAcademicYear = async (req, res) => {
  try {
    const {
      year,
      course,
      studyYear,
      startDate,
      endDate,
      feeActivationDate,
      feeDueDate,
      isCurrent,
      status
    } = req.body;

    const academicYear = await AcademicYear.findById(req.params.id);
    if (!academicYear) {
      return res.status(404).json({ success: false, message: 'Academic year configuration not found' });
    }

    const oldValues = academicYear.toObject();

    const start = startDate ? new Date(startDate) : academicYear.startDate;
    const end = endDate ? new Date(endDate) : academicYear.endDate;
    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: 'Start date must precede end date.'
      });
    }

    const targetYear = year ? year.trim() : academicYear.year;
    const targetCourse = course !== undefined ? (course || 'All').trim() : academicYear.course;
    const targetStudyYear = studyYear !== undefined ? (studyYear || 'All').trim() : academicYear.studyYear;

    // Check duplicate
    const duplicate = await AcademicYear.findOne({
      _id: { $ne: academicYear._id },
      year: targetYear,
      course: targetCourse,
      studyYear: targetStudyYear
    });
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: `An academic year configuration already exists for ${targetCourse} (${targetStudyYear}) - Session ${targetYear}.`
      });
    }

    if (isCurrent && !academicYear.isCurrent) {
      await AcademicYear.updateMany(
        { course: targetCourse, studyYear: targetStudyYear },
        { isCurrent: false }
      );
    }

    academicYear.year = targetYear;
    academicYear.course = targetCourse;
    academicYear.studyYear = targetStudyYear;
    academicYear.startDate = start;
    academicYear.endDate = end;
    if (feeActivationDate !== undefined) academicYear.feeActivationDate = feeActivationDate ? new Date(feeActivationDate) : null;
    if (feeDueDate !== undefined) academicYear.feeDueDate = feeDueDate ? new Date(feeDueDate) : null;
    if (isCurrent !== undefined) academicYear.isCurrent = Boolean(isCurrent);
    if (status !== undefined) academicYear.status = status;
    academicYear.updatedBy = req.user?._id;

    await academicYear.save();

    await createAuditLog({
      user: req.user?._id,
      userName: req.user?.name || 'Administrator',
      userRole: req.user?.role || 'admin',
      action: 'Academic Year Updated',
      entity: 'AcademicYear',
      entityId: academicYear._id.toString(),
      description: `Updated academic year ${targetYear} for ${targetCourse} (${targetStudyYear})`,
      oldValue: oldValues,
      newValue: academicYear.toObject(),
      reason: 'Academic session dates or parameters updated',
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: academicYear,
      message: 'Academic year configuration updated successfully'
    });
  } catch (error) {
    console.error('Update academic year error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Toggle academic year status (active / inactive / deactivation)
// @route   PATCH /api/audit/academic-years/:id/status
exports.toggleAcademicYearStatus = async (req, res) => {
  try {
    const academicYear = await AcademicYear.findById(req.params.id);
    if (!academicYear) {
      return res.status(404).json({ success: false, message: 'Academic year configuration not found' });
    }

    const newStatus = req.body.status || (academicYear.status === 'active' ? 'inactive' : 'active');
    const oldStatus = academicYear.status;
    academicYear.status = newStatus;
    academicYear.updatedBy = req.user?._id;
    await academicYear.save();

    await createAuditLog({
      user: req.user?._id,
      userName: req.user?.name || 'Administrator',
      userRole: req.user?.role || 'admin',
      action: newStatus === 'inactive' ? 'Academic Year Deactivated' : 'Academic Year Activated',
      entity: 'AcademicYear',
      entityId: academicYear._id.toString(),
      description: `Changed status of academic year ${academicYear.year} for ${academicYear.course} (${academicYear.studyYear}) from ${oldStatus} to ${newStatus}`,
      oldValue: { status: oldStatus },
      newValue: { status: newStatus },
      reason: req.body.reason || `Status set to ${newStatus}`,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: academicYear,
      message: `Academic year configuration status updated to ${newStatus}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete academic year configuration
// @route   DELETE /api/audit/academic-years/:id
exports.deleteAcademicYear = async (req, res) => {
  try {
    const academicYear = await AcademicYear.findById(req.params.id);
    if (!academicYear) {
      return res.status(404).json({ success: false, message: 'Academic year configuration not found' });
    }

    // Safety: check if active students or payments reference this academic year
    const oldData = academicYear.toObject();
    await AcademicYear.deleteOne({ _id: academicYear._id });

    await createAuditLog({
      user: req.user?._id,
      userName: req.user?.name || 'Administrator',
      userRole: req.user?.role || 'admin',
      action: 'Academic Year Deleted',
      entity: 'AcademicYear',
      entityId: req.params.id,
      description: `Deleted academic year configuration ${oldData.year} for ${oldData.course} (${oldData.studyYear})`,
      oldValue: oldData,
      reason: req.body.reason || 'Admin removed academic session configuration',
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Academic year configuration deleted successfully' });
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

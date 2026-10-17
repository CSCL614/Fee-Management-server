const Course = require('../models/Course');
const { generateId } = require('../utils/helpers');
const { createAuditLog } = require('./auditController');

const INITIAL_COURSES = [
  { degree: 'B.Sc', specialization: 'Chemistry', duration: 3, level: 'UG' },
  { degree: 'B.Sc', specialization: 'Computer Science', duration: 3, level: 'UG' },
  { degree: 'B.Sc', specialization: 'Zoology', duration: 3, level: 'UG' },
  { degree: 'B.Com', specialization: 'Computer Application', duration: 3, level: 'UG' },
  { degree: 'M.Sc', specialization: 'Organic Chemistry', duration: 2, level: 'PG' }
];

// Helper to seed initial courses if missing
const ensureInitialCourses = async () => {
  try {
    for (const item of INITIAL_COURSES) {
      const existing = await Course.findOne({ degree: item.degree, specialization: item.specialization });
      if (!existing) {
        const courseId = await generateId(Course, 'CRS', 'courseId');
        await Course.create({
          courseId,
          degree: item.degree,
          specialization: item.specialization,
          duration: item.duration,
          level: item.level,
          courseName: `${item.degree} ${item.specialization}`,
          status: 'active'
        });
      }
    }
  } catch (error) {
    console.error('Error ensuring initial courses:', error);
  }
};

// @desc    Get all courses (populated dynamically from MongoDB)
// @route   GET /api/courses
exports.getCourses = async (req, res) => {
  try {
    // Seed initial college courses if not present
    await ensureInitialCourses();

    const { degree, level, status } = req.query;
    const filter = {};
    if (degree) filter.degree = degree;
    if (level) filter.level = level;
    if (status) filter.status = status;
    else filter.status = 'active';

    const courses = await Course.find(filter).sort({ degree: 1, specialization: 1 });

    // Distinct degrees for filtering dropdowns
    const allActiveCourses = await Course.find({ status: 'active' });
    const distinctDegrees = Array.from(new Set(allActiveCourses.map(c => c.degree))).sort();

    res.json({
      success: true,
      data: {
        courses,
        degrees: distinctDegrees,
        total: courses.length
      }
    });
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching courses' });
  }
};

// @desc    Get single course
// @route   GET /api/courses/:id
exports.getCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    res.json({ success: true, data: course });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create new course (Admin only)
// @route   POST /api/courses
exports.createCourse = async (req, res) => {
  try {
    const { degree, specialization, duration, level } = req.body;

    if (!degree || !specialization || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Degree, specialization, and duration are required'
      });
    }

    const trimmedDegree = degree.trim();
    const trimmedSpecialization = specialization.trim();
    const parsedDuration = parseInt(duration, 10);

    if (isNaN(parsedDuration) || parsedDuration < 1 || parsedDuration > 6) {
      return res.status(400).json({
        success: false,
        message: 'Duration must be between 1 and 6 years'
      });
    }

    const existing = await Course.findOne({
      degree: trimmedDegree,
      specialization: new RegExp(`^${trimmedSpecialization}$`, 'i')
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Course with degree ${trimmedDegree} and specialization ${trimmedSpecialization} already exists`
      });
    }

    const derivedLevel = level || (trimmedDegree === 'M.Sc' || trimmedDegree === 'MBA' || trimmedDegree === 'MCA' ? 'PG' : 'UG');
    const courseId = await generateId(Course, 'CRS', 'courseId');

    const course = await Course.create({
      courseId,
      degree: trimmedDegree,
      specialization: trimmedSpecialization,
      duration: parsedDuration,
      level: derivedLevel,
      courseName: `${trimmedDegree} ${trimmedSpecialization}`,
      status: 'active'
    });

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Course Created',
      entity: 'Course',
      entityId: course.courseId,
      description: `Created course ${course.courseName} (${parsedDuration} yrs, ${derivedLevel})`,
      newValue: course.toObject(),
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: course,
      message: 'Course created successfully'
    });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Update course (Admin only)
// @route   PUT /api/courses/:id
exports.updateCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const { degree, specialization, duration, level, status } = req.body;
    const oldValue = course.toObject();

    if (degree) course.degree = degree.trim();
    if (specialization) course.specialization = specialization.trim();
    if (duration) course.duration = parseInt(duration, 10);
    if (level) course.level = level;
    if (status) course.status = status;
    course.courseName = `${course.degree} ${course.specialization}`;

    await course.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Course Updated',
      entity: 'Course',
      entityId: course.courseId,
      description: `Updated course ${course.courseName}`,
      oldValue,
      newValue: course.toObject(),
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: course,
      message: 'Course updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Delete/Deactivate course (Admin only)
// @route   DELETE /api/courses/:id
exports.deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    course.status = 'inactive';
    await course.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Course Deactivated',
      entity: 'Course',
      entityId: course.courseId,
      description: `Deactivated course ${course.courseName}`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Course deactivated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Export helper for server boot seeding
exports.ensureInitialCourses = ensureInitialCourses;

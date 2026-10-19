const Student = require('../models/Student');
const Course = require('../models/Course');
const FeeDemand = require('../models/FeeDemand');
const FeeStructure = require('../models/FeeStructure');
const Payment = require('../models/Payment');
const { calculateFeeSummary, generateFeeLedger } = require('../utils/feeCalculator');
const { createAuditLog, generateId } = require('../utils/helpers');

// @desc    Get all students with filters
// @route   GET /api/students
exports.getStudents = async (req, res) => {
  try {
    const { search, level, course, batch, year, academicYear, status, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { name: searchRegex },
        { studentId: searchRegex },
        { admissionNo: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { batch: searchRegex },
        { course: searchRegex }
      ];
    }

    if (level) filter.level = level;
    if (course) filter.course = course;
    if (batch) filter.batch = new RegExp(batch, 'i');
    if (year) filter.currentYear = year;
    if (academicYear) filter.currentAcademicYear = academicYear;
    if (status) filter.status = status;

    const total = await Student.countDocuments(filter);
    const students = await Student.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Calculate fee summary for each student
    const studentsWithFees = await Promise.all(
      students.map(async (student) => {
        try {
          const summary = await calculateFeeSummary(student.studentId);
          return {
            ...student.toObject(),
            totalFee: summary.overall.totalFee,
            totalPaid: summary.overall.totalPaid,
            totalPending: summary.overall.totalPending,
            feeStatus: summary.overall.status
          };
        } catch {
          return {
            ...student.toObject(),
            totalFee: 0,
            totalPaid: 0,
            totalPending: 0,
            feeStatus: 'No Demand'
          };
        }
      })
    );

    res.json({
      success: true,
      data: studentsWithFees,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Search students (global search)
// @route   GET /api/students/search
exports.searchStudents = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const searchRegex = new RegExp(q, 'i');
    const students = await Student.find({
      $or: [
        { name: searchRegex },
        { studentId: searchRegex },
        { admissionNo: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { batch: searchRegex },
        { course: searchRegex }
      ]
    }).limit(10);

    const results = await Promise.all(
      students.map(async (student) => {
        try {
          const summary = await calculateFeeSummary(student.studentId);
          return {
            _id: student._id,
            studentId: student.studentId,
            admissionNo: student.admissionNo,
            name: student.name,
            course: student.course,
            level: student.level,
            batch: student.batch,
            currentYear: student.currentYear,
            totalPending: summary.overall.totalPending,
            feeStatus: summary.overall.status
          };
        } catch {
          return {
            _id: student._id,
            studentId: student.studentId,
            admissionNo: student.admissionNo,
            name: student.name,
            course: student.course,
            level: student.level,
            batch: student.batch,
            currentYear: student.currentYear,
            totalPending: 0,
            feeStatus: 'No Demand'
          };
        }
      })
    );

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single student with fee summary
// @route   GET /api/students/:id
exports.getStudent = async (req, res) => {
  try {
    const student = await Student.findOne({
      $or: [
        { studentId: req.params.id },
        { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : undefined }
      ].filter(Boolean)
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const feeSummary = await calculateFeeSummary(student.studentId);
    const feeLedger = await generateFeeLedger(student.studentId);

    res.json({
      success: true,
      data: {
        student: student.toObject(),
        feeSummary,
        feeLedger
      }
    });
  } catch (error) {
    console.error('Get student error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create student
// @route   POST /api/students
exports.createStudent = async (req, res) => {
  try {
    const {
      admissionNo,
      name,
      degree,
      specialization,
      courseId,
      course,
      level,
      currentYear,
      currentAcademicYear,
      batch: customBatch,
      email,
      phone,
      fatherName,
      address,
      dateOfBirth,
      gender
    } = req.body;

    // Validate required fields
    if (!admissionNo || !admissionNo.trim()) {
      return res.status(400).json({ success: false, message: 'Admission number is required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Student name is required' });
    }
    if (!degree || !degree.trim()) {
      return res.status(400).json({ success: false, message: 'Degree is required' });
    }
    if (!specialization || !specialization.trim()) {
      return res.status(400).json({ success: false, message: 'Specialization is required' });
    }
    if (!currentYear || !currentYear.trim()) {
      return res.status(400).json({ success: false, message: 'Year of study is required' });
    }
    if (!currentAcademicYear || !currentAcademicYear.trim()) {
      return res.status(400).json({ success: false, message: 'Academic year is required' });
    }

    // Check duplicate admission number
    const trimmedAdm = admissionNo.trim();
    const existing = await Student.findOne({ admissionNo: trimmedAdm });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A student with this admission number already exists'
      });
    }

    // Lookup course from Course model
    let courseDoc = null;
    if (courseId) {
      courseDoc = await Course.findById(courseId);
    }
    if (!courseDoc) {
      courseDoc = await Course.findOne({
        degree: degree.trim(),
        specialization: specialization.trim()
      });
    }

    // Course duration & level validation
    const duration = courseDoc ? courseDoc.duration : (degree.trim() === 'M.Sc' ? 2 : 3);
    const derivedLevel = courseDoc ? courseDoc.level : (degree.trim() === 'M.Sc' ? 'PG' : 'UG');
    const courseDisplayName = course || (courseDoc ? courseDoc.courseName : `${degree.trim()} ${specialization.trim()}`);

    // Backend validation of course duration and year of study
    const allowedYearsMap = {
      1: ['1st Year'],
      2: ['1st Year', '2nd Year'],
      3: ['1st Year', '2nd Year', '3rd Year'],
      4: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
      5: ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'],
      6: ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', '6th Year']
    };
    const allowedYears = allowedYearsMap[duration] || ['1st Year', '2nd Year', '3rd Year'];

    if (!allowedYears.includes(currentYear)) {
      return res.status(400).json({
        success: false,
        message: `Invalid year of study "${currentYear}". ${degree} ${specialization} is a ${duration}-year course (Allowed: ${allowedYears.join(', ')})`
      });
    }

    // Calculate Batch
    let startYear;
    if (trimmedAdm) {
      const match = trimmedAdm.match(/\d{4}/);
      if (match) startYear = parseInt(match[0], 10);
    }
    if (!startYear && currentAcademicYear) {
      const parts = currentAcademicYear.split('-');
      if (parts[0]) startYear = parseInt(parts[0], 10);
    }
    if (!startYear) startYear = new Date().getFullYear();

    const batchStartYear = startYear;
    const batchEndYear = startYear + duration;
    const calculatedBatch = `${batchStartYear}–${batchEndYear}`;
    const finalBatch = customBatch || calculatedBatch;

    const studentId = await generateId(Student, 'STU', 'studentId');

    const student = await Student.create({
      studentId,
      admissionNo: trimmedAdm,
      name: name.trim(),
      degree: degree.trim(),
      specialization: specialization.trim(),
      courseId: courseDoc ? courseDoc._id : undefined,
      duration,
      course: courseDisplayName,
      level: derivedLevel,
      currentYear,
      currentAcademicYear,
      batchStartYear,
      batchEndYear,
      batch: finalBatch,
      enrollmentHistory: [{
        year: currentYear,
        academicYear: currentAcademicYear,
        promotedAt: new Date()
      }],
      email,
      phone,
      fatherName,
      address,
      dateOfBirth,
      gender
    });

    // Auto-create fee demand from fee structure if available
    const escapeRegex = (s) => (s ? s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : '');
    const courseRegexList = [
      new RegExp(`^${escapeRegex(courseDisplayName)}$`, 'i'),
      new RegExp(`^${escapeRegex(specialization.trim())}$`, 'i'),
      new RegExp(`^${escapeRegex(degree.trim())}\\s*[-—]?\\s*${escapeRegex(specialization.trim())}$`, 'i'),
      new RegExp(`^${escapeRegex(degree.trim())}$`, 'i')
    ];

    const feeStructures = await FeeStructure.find({
      course: { $in: courseRegexList },
      year: new RegExp(`^${escapeRegex(currentYear.trim())}$`, 'i'),
      academicYear: currentAcademicYear.trim(),
      status: 'active'
    });

    if (feeStructures.length > 0) {
      const now = new Date();
      const categories = feeStructures.map(fs => ({
        category: fs.category,
        amount: fs.amount,
        frequency: fs.frequency || 'ANNUAL',
        semester: fs.semester || null,
        activationDate: fs.activationDate || null,
        dueDate: fs.dueDate || null,
        status: (fs.activationDate && new Date(fs.activationDate) > now) ? 'upcoming' : 'active'
      }));
      const totalDemand = categories.reduce((sum, c) => sum + c.amount, 0);

      await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear: currentAcademicYear.trim(),
        year: currentYear.trim(),
        course: courseDisplayName,
        level: derivedLevel,
        categories,
        totalDemand,
        createdBy: req.user._id
      });
    }

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Created',
      entity: 'Student',
      entityId: student.studentId,
      description: `Created student ${student.name} (${trimmedAdm}) - ${student.course}`,
      newValue: {
        studentId,
        admissionNo: trimmedAdm,
        name: student.name,
        degree: student.degree,
        specialization: student.specialization,
        course: student.course,
        level: student.level,
        batch: student.batch,
        currentYear,
        currentAcademicYear
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: student,
      message: 'Student created successfully'
    });
  } catch (error) {
    console.error('Create student error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Update student
// @route   PUT /api/students/:id
exports.updateStudent = async (req, res) => {
  try {
    const student = await Student.findOne({
      $or: [
        { studentId: req.params.id },
        { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : undefined }
      ].filter(Boolean)
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const oldValue = student.toObject();

    // Prevent duplicate admission number (exclude self)
    if (req.body.admissionNo && req.body.admissionNo.trim() !== student.admissionNo) {
      const existing = await Student.findOne({
        admissionNo: req.body.admissionNo.trim(),
        _id: { $ne: student._id }
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'A student with this admission number already exists'
        });
      }
      student.admissionNo = req.body.admissionNo.trim();
    }

    const allowedFields = [
      'name', 'email', 'phone', 'fatherName', 'address', 'dateOfBirth', 'gender',
      'status', 'degree', 'specialization', 'course', 'courseId', 'duration',
      'level', 'currentYear', 'currentAcademicYear', 'batch'
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] === 'string') {
          student[field] = req.body[field].trim();
        } else {
          student[field] = req.body[field];
        }
      }
    }

    await student.save();

    // If course or level changed, synchronize active fee demands course/level for consistency
    if (req.body.course || req.body.level) {
      await FeeDemand.updateMany(
        { $or: [{ student: student._id }, { studentId: student.studentId }] },
        {
          $set: {
            ...(req.body.course && { course: student.course }),
            ...(req.body.level && { level: student.level })
          }
        }
      );
    }

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Profile Updated',
      entity: 'Student',
      entityId: student.studentId,
      description: `Updated profile for student ${student.name} (${student.admissionNo || student.studentId})`,
      oldValue: {
        name: oldValue.name,
        admissionNo: oldValue.admissionNo,
        course: oldValue.course,
        level: oldValue.level,
        currentYear: oldValue.currentYear,
        status: oldValue.status,
        email: oldValue.email,
        phone: oldValue.phone
      },
      newValue: {
        name: student.name,
        admissionNo: student.admissionNo,
        course: student.course,
        level: student.level,
        currentYear: student.currentYear,
        status: student.status,
        email: student.email,
        phone: student.phone
      },
      reason: req.body.reason || 'Admin profile update',
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: student,
      message: 'Student profile updated successfully'
    });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Change student status (e.g. Active, Inactive, Graduated, Discontinued, Transferred)
// @route   PATCH /api/students/:id/status
exports.updateStudentStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const validStatuses = ['Active', 'Inactive', 'Graduated', 'Discontinued', 'Transferred'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed statuses: ${validStatuses.join(', ')}`
      });
    }

    const student = await Student.findOne({
      $or: [
        { studentId: req.params.id },
        { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : undefined }
      ].filter(Boolean)
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const oldStatus = student.status;
    student.status = status;
    await student.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: status === 'Inactive' ? 'Student Deactivated' : (status === 'Active' ? 'Student Reactivated' : 'Student Status Changed'),
      entity: 'Student',
      entityId: student.studentId,
      description: `Changed status of ${student.name} (${student.admissionNo || student.studentId}) from "${oldStatus}" to "${status}"`,
      oldValue: { status: oldStatus },
      newValue: { status },
      reason: reason || (status === 'Inactive' ? 'Student account deactivated by administrator' : `Student status set to ${status}`),
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: student,
      message: `Student status successfully changed to "${status}"`
    });
  } catch (error) {
    console.error('Update student status error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Delete student or enforce safe deactivation if payments exist
// @route   DELETE /api/students/:id
exports.deleteStudent = async (req, res) => {
  try {
    const student = await Student.findOne({
      $or: [
        { studentId: req.params.id },
        { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : undefined }
      ].filter(Boolean)
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Check if student has payment records
    const paymentCount = await Payment.countDocuments({
      $or: [
        { student: student._id },
        { studentId: student.studentId }
      ]
    });

    if (paymentCount > 0) {
      return res.status(400).json({
        success: false,
        hasPayments: true,
        paymentCount,
        message: `This student has ${paymentCount} recorded payment transaction(s). To maintain financial ledger accuracy and audit compliance, students with payment history cannot be permanently deleted. You can Deactivate this student instead to disable their account and archive their record.`
      });
    }

    const reason = req.body?.reason || req.query?.reason || 'Student record deleted by administrator';

    // Delete associated unbilled fee demands
    await FeeDemand.deleteMany({
      $or: [
        { student: student._id },
        { studentId: student.studentId }
      ]
    });

    // Delete student document
    await Student.deleteOne({ _id: student._id });

    // Create Audit Log
    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Deleted',
      entity: 'Student',
      entityId: student.studentId,
      description: `Permanently deleted student ${student.name} (${student.admissionNo || student.studentId}) with 0 payments`,
      oldValue: student.toObject(),
      reason,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Student ${student.name} (${student.admissionNo || student.studentId}) deleted successfully`
    });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Promote student to next year
// @route   POST /api/students/:id/promote
exports.promoteStudent = async (req, res) => {
  try {
    const { newYear, newAcademicYear } = req.body;

    if (!newYear || !newAcademicYear) {
      return res.status(400).json({
        success: false,
        message: 'New year and academic year are required'
      });
    }

    const student = await Student.findOne({ studentId: req.params.id });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const oldYear = student.currentYear;
    const oldAcademicYear = student.currentAcademicYear;

    // Add to enrollment history without modifying past records
    student.enrollmentHistory.push({
      year: newYear,
      academicYear: newAcademicYear,
      promotedAt: new Date()
    });

    student.currentYear = newYear;
    student.currentAcademicYear = newAcademicYear;

    await student.save();

    // Auto-create fee demand from fee structure for new year
    const feeStructures = await FeeStructure.find({
      course: student.course,
      level: student.level,
      year: newYear,
      academicYear: newAcademicYear,
      status: 'active'
    });

    if (feeStructures.length > 0) {
      const categories = feeStructures.map(fs => ({
        category: fs.category,
        amount: fs.amount
      }));
      const totalDemand = categories.reduce((sum, c) => sum + c.amount, 0);

      await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear: newAcademicYear,
        year: newYear,
        course: student.course,
        level: student.level,
        categories,
        totalDemand,
        createdBy: req.user._id
      });
    }

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Promoted',
      entity: 'Student',
      entityId: student.studentId,
      description: `Promoted ${student.name} from ${oldYear} (${oldAcademicYear}) to ${newYear} (${newAcademicYear})`,
      oldValue: { year: oldYear, academicYear: oldAcademicYear },
      newValue: { year: newYear, academicYear: newAcademicYear },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: student,
      message: `Student promoted to ${newYear} (${newAcademicYear}) successfully`
    });
  } catch (error) {
    console.error('Promote student error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get student fee summary
// @route   GET /api/students/:id/fee-summary
exports.getFeeSummary = async (req, res) => {
  try {
    const { academicYear } = req.query;
    const summary = await calculateFeeSummary(req.params.id, academicYear);
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Fee summary error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Get student fee ledger
// @route   GET /api/students/:id/ledger
exports.getFeeLedger = async (req, res) => {
  try {
    const ledger = await generateFeeLedger(req.params.id);
    res.json({ success: true, data: ledger });
  } catch (error) {
    console.error('Fee ledger error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Get unique courses list
// @route   GET /api/students/courses
exports.getCourses = async (req, res) => {
  try {
    const activeCourses = await Course.find({ status: 'active' });
    const courseNamesFromDB = activeCourses.map(c => c.courseName || `${c.degree} ${c.specialization}`);
    const studentCourses = await Student.distinct('course');
    const combinedCourses = Array.from(new Set([...courseNamesFromDB, ...studentCourses])).filter(Boolean).sort();

    const levels = await Student.distinct('level');
    const batches = await Student.distinct('batch');
    res.json({
      success: true,
      data: {
        courses: combinedCourses,
        levels: Array.from(new Set(['UG', 'PG', ...levels])).filter(Boolean),
        batches: batches.filter(Boolean).sort()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

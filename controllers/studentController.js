const Student = require('../models/Student');
const FeeDemand = require('../models/FeeDemand');
const FeeStructure = require('../models/FeeStructure');
const Payment = require('../models/Payment');
const { calculateFeeSummary, generateFeeLedger } = require('../utils/feeCalculator');
const { createAuditLog, generateId } = require('../utils/helpers');

// @desc    Get all students with filters
// @route   GET /api/students
exports.getStudents = async (req, res) => {
  try {
    const { search, level, course, year, academicYear, status, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { name: searchRegex },
        { studentId: searchRegex },
        { admissionNo: searchRegex },
        { phone: searchRegex },
        { email: searchRegex }
      ];
    }

    if (level) filter.level = level;
    if (course) filter.course = course;
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
        { email: searchRegex }
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
    const { admissionNo, name, course, level, currentYear, currentAcademicYear, email, phone, fatherName, address, dateOfBirth, gender } = req.body;

    // Check duplicate admission number
    const existing = await Student.findOne({ admissionNo });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A student with this admission number already exists'
      });
    }

    const studentId = await generateId(Student, 'STU', 'studentId');

    const student = await Student.create({
      studentId,
      admissionNo,
      name,
      course,
      level,
      currentYear,
      currentAcademicYear,
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
    const feeStructures = await FeeStructure.find({
      course,
      level,
      year: currentYear,
      academicYear: currentAcademicYear,
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
        academicYear: currentAcademicYear,
        year: currentYear,
        course,
        level,
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
      description: `Created student ${name} (${admissionNo})`,
      newValue: { studentId, admissionNo, name, course, level, currentYear, currentAcademicYear },
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
    const student = await Student.findOne({ studentId: req.params.id });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const oldValue = student.toObject();

    // Prevent duplicate admission number
    if (req.body.admissionNo && req.body.admissionNo !== student.admissionNo) {
      const existing = await Student.findOne({ admissionNo: req.body.admissionNo });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'A student with this admission number already exists'
        });
      }
    }

    const allowedFields = ['name', 'admissionNo', 'email', 'phone', 'fatherName', 'address', 'dateOfBirth', 'gender', 'status'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        student[field] = req.body[field];
      }
    }

    await student.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Updated',
      entity: 'Student',
      entityId: student.studentId,
      description: `Updated student ${student.name}`,
      oldValue: { name: oldValue.name, email: oldValue.email, phone: oldValue.phone, status: oldValue.status },
      newValue: { name: student.name, email: student.email, phone: student.phone, status: student.status },
      reason: req.body.reason || 'Profile update',
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: student,
      message: 'Student updated successfully'
    });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
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
    const courses = await Student.distinct('course');
    const levels = await Student.distinct('level');
    res.json({ success: true, data: { courses, levels } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const Student = require('../models/Student');
const Course = require('../models/Course');
const Payment = require('../models/Payment');
const FeeDemand = require('../models/FeeDemand');
const FeeStructure = require('../models/FeeStructure');
const { calculateFeeSummary, calculateBatchFeeSummaries, generateFeeLedger } = require('../utils/feeCalculator');
const { createAuditLog, generateId } = require('../utils/helpers');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const escapeRegex = (s) => (s ? s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : '');

// Helper to score student match relevance for live search
function scoreStudent(student, query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return 0;
  const name = (student.name || '').toLowerCase();
  const adm = (student.admissionNo || '').toLowerCase();
  const roll = (student.rollNo || '').toLowerCase();
  const sid = (student.studentId || '').toLowerCase();
  const phone = (student.phone || '').replace(/\D/g, '');
  const qDigits = q.replace(/\D/g, '');

  let score = 0;
  // Exact matches
  if (name === q) score += 1000;
  else if (adm === q || roll === q || sid === q) score += 900;
  // Name starts with query
  else if (name.startsWith(q)) score += 800;
  // Any word in name starts with query (e.g. "Chaitanya Devi" or "Devi Chaitanya")
  else if (name.split(/\s+/).some(w => w.startsWith(q))) score += 700;
  // Name contains query
  else if (name.includes(q)) score += 600;
  // Admission or roll starts with query
  else if (adm.startsWith(q) || roll.startsWith(q) || sid.startsWith(q)) score += 500;
  // Admission or roll contains query
  else if (adm.includes(q) || roll.includes(q) || sid.includes(q)) score += 400;
  // Phone match (e.g. last 4 digits or contains)
  else if (qDigits.length >= 3 && phone.includes(qDigits)) {
    if (phone.endsWith(qDigits)) score += 350;
    else score += 300;
  }
  // Course / Specialization match
  else if ((student.course || '').toLowerCase().includes(q)) score += 100;
  else if ((student.specialization || '').toLowerCase().includes(q)) score += 80;
  else score += 50;

  if (student.status === 'Active') score += 10;
  return score;
}

// @desc    Get all students with filters
// @route   GET /api/students
exports.getStudents = async (req, res) => {
  try {
    const { search, level, course, batch, year, academicYear, status, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (search && search.trim()) {
      const trimmed = search.trim();
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      const words = trimmed.split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const multiWordRegex = new RegExp(words.map(w => `(?=.*${w})`).join(''), 'i');

      const searchConditions = [
        { name: multiWordRegex },
        { name: searchRegex },
        { studentId: searchRegex },
        { admissionNo: searchRegex },
        { rollNo: searchRegex },
        { phone: searchRegex }
      ];

      if (trimmed.length >= 3) {
        searchConditions.push({ course: searchRegex });
        searchConditions.push({ specialization: searchRegex });
        searchConditions.push({ degree: searchRegex });
        searchConditions.push({ email: searchRegex });
      }

      filter.$or = searchConditions;
    }

    if (level) filter.level = level;
    if (course) filter.course = course;
    if (batch) filter.batch = new RegExp(batch, 'i');
    if (year) filter.currentYear = year;
    if (academicYear) filter.currentAcademicYear = academicYear;
    if (status) filter.status = status;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Fetch count and paginated students concurrently
    const [total, rawStudents] = await Promise.all([
      Student.countDocuments(filter),
      Student.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean()
    ]);

    // If search was performed, sort returned page by relevance score
    let students = rawStudents;
    if (search && search.trim()) {
      students = [...rawStudents].sort((a, b) => scoreStudent(b, search) - scoreStudent(a, search));
    }

    // Batch calculate fee summary for all students in 2 queries total
    const summaryMap = await calculateBatchFeeSummaries(students);

    const studentsWithFees = students.map((student) => {
      const summary = summaryMap.get(student._id.toString());
      return {
        ...student,
        totalFee: summary?.overall?.totalFee || 0,
        totalPaid: summary?.overall?.totalPaid || 0,
        totalPending: summary?.overall?.totalPending || 0,
        feeStatus: summary?.overall?.status || 'No Demand'
      };
    });

    res.json({
      success: true,
      data: studentsWithFees,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Search students (global search with relevance scoring)
// @route   GET /api/students/search
exports.searchStudents = async (req, res) => {
  try {
    const { q, limit = 15 } = req.query;
    if (!q || !q.trim() || q.trim().length < 1) {
      return res.json({ success: true, data: [] });
    }

    const trimmed = q.trim();
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escaped, 'i');

    // Multi-word case-insensitive matching (e.g. "Chaitanya Kumar" matches "ch", "Ch", "CHAI", "chaitanya", "kumar")
    const words = trimmed.split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const multiWordRegex = new RegExp(words.map(w => `(?=.*${w})`).join(''), 'i');

    const orConditions = [
      { name: multiWordRegex },
      { name: searchRegex },
      { studentId: searchRegex },
      { admissionNo: searchRegex },
      { rollNo: searchRegex },
      { phone: searchRegex }
    ];

    // For queries of length >= 3, also search course, specialization, degree, email
    if (trimmed.length >= 3) {
      orConditions.push({ course: searchRegex });
      orConditions.push({ specialization: searchRegex });
      orConditions.push({ degree: searchRegex });
      orConditions.push({ email: searchRegex });
    }

    // Fetch up to 60 candidate students and rank by relevance score
    const maxCandidates = 60;
    const candidates = await Student.find({ $or: orConditions }).limit(maxCandidates).lean();

    // Sort candidates by match precision score
    candidates.sort((a, b) => scoreStudent(b, trimmed) - scoreStudent(a, trimmed));

    const topLimit = Math.min(parseInt(limit, 10) || 15, 30);
    const students = candidates.slice(0, topLimit);

    // Batch calculate fee summaries for all search matches in 2 queries
    const summaryMap = await calculateBatchFeeSummaries(students);

    const results = students.map((student) => {
      const summary = summaryMap.get(student._id.toString());
      return {
        _id: student._id,
        studentId: student.studentId,
        admissionNo: student.admissionNo,
        rollNo: student.rollNo || null,
        name: student.name,
        profilePhoto: student.profilePhoto || null,
        phone: student.phone || '',
        email: student.email || '',
        course: student.course,
        specialization: student.specialization || '',
        degree: student.degree || '',
        level: student.level,
        batch: student.batch,
        currentYear: student.currentYear,
        currentAcademicYear: student.currentAcademicYear,
        status: student.status,
        totalPending: summary?.overall?.totalPending || 0,
        totalPaid: summary?.overall?.totalPaid || 0,
        totalFee: summary?.overall?.totalFee || 0,
        feeStatus: summary?.overall?.status || 'No Demand'
      };
    });

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
    }).lean();

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Run fee summary and fee ledger concurrently
    const [feeSummary, feeLedger] = await Promise.all([
      calculateFeeSummary(student.studentId),
      generateFeeLedger(student.studentId)
    ]);

    res.json({
      success: true,
      data: {
        student,
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

    // Determine progression history and academic years up to currentYear
    const yearMatch = currentYear.match(/^(\d+)/);
    const currentYearNum = yearMatch ? parseInt(yearMatch[1], 10) : 1;
    const ayParts = currentAcademicYear.split('-');
    const currentAyStart = parseInt(ayParts[0], 10) || new Date().getFullYear();

    const enrollmentHistory = [];
    const yearsProgression = [];

    for (let y = 1; y <= currentYearNum; y++) {
      const suffix = y === 1 ? 'st' : y === 2 ? 'nd' : y === 3 ? 'rd' : 'th';
      const yearName = `${y}${suffix} Year`;
      const yStart = currentAyStart - (currentYearNum - y);
      const yEnd = (yStart + 1).toString().slice(-2);
      const ayString = `${yStart}-${yEnd}`;

      yearsProgression.push({ year: yearName, academicYear: ayString, startYear: yStart });
      enrollmentHistory.push({
        year: yearName,
        academicYear: ayString,
        promotedAt: y === currentYearNum ? new Date() : new Date(`${yStart}-06-15T09:00:00Z`)
      });
    }

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
      enrollmentHistory,
      email,
      phone,
      fatherName,
      address,
      dateOfBirth,
      gender,
      profilePhoto: req.body.profilePhoto || null
    });

    // Auto-create fee demands from fee structure for all progression years
    const escapeRegex = (s) => (s ? s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : '');
    const courseRegexList = [
      new RegExp(`^${escapeRegex(courseDisplayName)}$`, 'i'),
      new RegExp(`^${escapeRegex(specialization.trim())}$`, 'i'),
      new RegExp(`^${escapeRegex(degree.trim())}\\s*[-—]?\\s*${escapeRegex(specialization.trim())}$`, 'i'),
      new RegExp(`^${escapeRegex(degree.trim())}$`, 'i')
    ];

    const now = new Date();

    for (const prog of yearsProgression) {
      let feeStructures = await FeeStructure.find({
        course: { $in: courseRegexList },
        year: new RegExp(`^${escapeRegex(prog.year.trim())}$`, 'i'),
        academicYear: prog.academicYear.trim(),
        status: 'active'
      });

      // Fallback: If no fee structure found for historical academic year, look for the course's active structure for that year
      if (feeStructures.length === 0) {
        feeStructures = await FeeStructure.find({
          course: { $in: courseRegexList },
          year: new RegExp(`^${escapeRegex(prog.year.trim())}$`, 'i'),
          status: 'active'
        });
      }

      if (feeStructures.length > 0) {
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
          academicYear: prog.academicYear.trim(),
          year: prog.year.trim(),
          course: courseDisplayName,
          level: derivedLevel,
          categories,
          totalDemand,
          createdBy: req.user._id
        });
      }
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
      'level', 'currentYear', 'currentAcademicYear', 'batch', 'profilePhoto'
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
    const ledger = await generateFeeLedger(req.params.id, req.query);
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

// ==========================================
// REQUIREMENT 2: STUDENT PROFILE PHOTO UPLOAD
// ==========================================

// @desc    Upload temporary / new student photo before record creation
// @route   POST /api/students/upload-photo
exports.uploadTempPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select an image file to upload' });
    }
    const ext = path.extname(req.file.originalname) || '.jpg';
    const fileName = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    
    // Save to local disk
    const diskPath = path.join(__dirname, '..', 'uploads', 'profiles', fileName);
    fs.writeFileSync(diskPath, req.file.buffer);

    // Save to GridFS for cloud/Vercel persistence
    if (mongoose.connection.readyState === 1) {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'student_photos' });
      const uploadStream = bucket.openUploadStream(fileName, { contentType: req.file.mimetype });
      uploadStream.end(req.file.buffer);
    }

    const photoUrl = `/api/students/photo/${fileName}`;
    res.json({
      success: true,
      data: { photoUrl },
      message: 'Photo uploaded successfully'
    });
  } catch (error) {
    console.error('Upload temp photo error:', error);
    res.status(500).json({ success: false, message: error.message || 'Image upload failed' });
  }
};

// @desc    Upload or replace photo for an existing student
// @route   POST /api/students/:id/photo
exports.uploadStudentPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select an image file to upload' });
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

    const ext = path.extname(req.file.originalname) || '.jpg';
    const fileName = `student_${student.studentId || student._id}_${Date.now()}${ext}`;

    // Save to local disk
    const diskPath = path.join(__dirname, '..', 'uploads', 'profiles', fileName);
    fs.writeFileSync(diskPath, req.file.buffer);

    // Save to GridFS for permanent storage across deployments
    if (mongoose.connection.readyState === 1) {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'student_photos' });
      const uploadStream = bucket.openUploadStream(fileName, { contentType: req.file.mimetype });
      uploadStream.end(req.file.buffer);
    }

    const oldPhoto = student.profilePhoto;
    student.profilePhoto = `/api/students/photo/${fileName}`;
    await student.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Photo Uploaded',
      entity: 'Student',
      entityId: student.studentId,
      description: `Uploaded profile photo for ${student.name} (${student.admissionNo || student.studentId})`,
      oldValue: { profilePhoto: oldPhoto },
      newValue: { profilePhoto: student.profilePhoto },
      reason: 'Profile photo updated',
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: { profilePhoto: student.profilePhoto },
      message: 'Student profile photo updated successfully'
    });
  } catch (error) {
    console.error('Upload student photo error:', error);
    res.status(500).json({ success: false, message: error.message || 'Image upload failed' });
  }
};

// @desc    Remove photo from student profile
// @route   DELETE /api/students/:id/photo
exports.deleteStudentPhoto = async (req, res) => {
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

    const oldPhoto = student.profilePhoto;
    student.profilePhoto = null;
    await student.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Photo Removed',
      entity: 'Student',
      entityId: student.studentId,
      description: `Removed profile photo for ${student.name} (${student.admissionNo || student.studentId})`,
      oldValue: { profilePhoto: oldPhoto },
      newValue: { profilePhoto: null },
      reason: 'Profile photo removed',
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Student profile photo removed successfully'
    });
  } catch (error) {
    console.error('Delete student photo error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Serve student profile photo (from local disk or GridFS)
// @route   GET /api/students/photo/:filename
exports.getStudentPhoto = async (req, res) => {
  try {
    const fileName = req.params.filename;
    // Prevent directory traversal
    const safeFileName = path.basename(fileName);
    const diskPath = path.join(__dirname, '..', 'uploads', 'profiles', safeFileName);

    if (fs.existsSync(diskPath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(diskPath);
    }

    // GridFS fallback
    if (mongoose.connection.readyState === 1) {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'student_photos' });
      const files = await bucket.find({ filename: safeFileName }).toArray();
      if (files.length > 0) {
        res.setHeader('Content-Type', files[0].contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const downloadStream = bucket.openDownloadStreamByName(safeFileName);
        return downloadStream.pipe(res);
      }
    }

    return res.status(404).json({ success: false, message: 'Photo not found' });
  } catch (error) {
    res.status(404).json({ success: false, message: 'Photo not found' });
  }
};

// ==========================================
// REQUIREMENT 3: MULTI-STUDENT SELECTION & BULK DELETION
// ==========================================

// @desc    Preview multi-student deletion and check financial records
// @route   POST /api/students/bulk-delete/preview
exports.previewBulkDelete = async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No students selected' });
    }

    const students = await Student.find({
      $or: [
        { studentId: { $in: studentIds } },
        { _id: { $in: studentIds.filter(id => typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) } }
      ]
    }).lean();

    const previewList = [];
    let willArchiveCount = 0;
    let willDeleteCount = 0;

    for (const student of students) {
      const paymentCount = await Payment.countDocuments({
        $or: [{ student: student._id }, { studentId: student.studentId }]
      });
      const demandCount = await FeeDemand.countDocuments({
        $or: [{ student: student._id }, { studentId: student.studentId }]
      });

      const hasFinancialHistory = paymentCount > 0;
      if (hasFinancialHistory) {
        willArchiveCount++;
      } else {
        willDeleteCount++;
      }

      previewList.push({
        _id: student._id,
        studentId: student.studentId,
        admissionNo: student.admissionNo,
        name: student.name,
        course: student.course,
        currentYear: student.currentYear,
        paymentCount,
        demandCount,
        hasFinancialHistory,
        actionType: hasFinancialHistory ? 'archive' : 'delete',
        note: hasFinancialHistory
          ? `Has ${paymentCount} recorded payment transaction(s). Will be safely archived to protect financial ledger.`
          : `0 payment transactions. Can be safely deleted.`
      });
    }

    res.json({
      success: true,
      data: {
        totalSelected: students.length,
        willArchiveCount,
        willDeleteCount,
        counts: {
          total: students.length,
          archival: willArchiveCount,
          permanent: willDeleteCount
        },
        students: previewList,
        preview: previewList.map(item => ({
          ...item,
          action: item.actionType,
          hasPayments: item.paymentCount > 0,
          hasDemands: item.demandCount > 0
        }))
      }
    });
  } catch (error) {
    console.error('Preview bulk delete error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Bulk delete or safely archive selected students
// @route   POST /api/students/bulk-delete
exports.bulkDeleteStudents = async (req, res) => {
  try {
    const { studentIds, reason } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide at least one student ID' });
    }

    const students = await Student.find({
      $or: [
        { studentId: { $in: studentIds } },
        { _id: { $in: studentIds.filter(id => typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) } }
      ]
    });

    if (students.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching students found' });
    }

    const archivedList = [];
    const deletedList = [];
    const auditReason = reason || 'Bulk student deletion initiated by administrator';

    for (const student of students) {
      const paymentCount = await Payment.countDocuments({
        $or: [{ student: student._id }, { studentId: student.studentId }]
      });

      if (paymentCount > 0) {
        // Safe archival / soft deletion: preserve payments, receipts, demands, ledger
        student.status = 'Archived';
        student.isArchived = true;
        student.archivedAt = new Date();
        student.archivedBy = req.user._id;
        student.archiveReason = auditReason;
        await student.save();
        archivedList.push(student);
      } else {
        // No payments: delete associated unbilled demands and remove student
        await FeeDemand.deleteMany({
          $or: [{ student: student._id }, { studentId: student.studentId }]
        });
        await Student.deleteOne({ _id: student._id });
        deletedList.push(student);
      }
    }

    // Comprehensive audit log
    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Bulk Student Deletion',
      entity: 'Student',
      description: `Bulk deletion executed on ${students.length} students: ${archivedList.length} safely archived (financial records preserved), ${deletedList.length} permanently deleted`,
      oldValue: {
        totalRequested: studentIds.length,
        affectedStudents: students.map(s => ({
          studentId: s.studentId,
          admissionNo: s.admissionNo,
          name: s.name,
          course: s.course
        }))
      },
      newValue: {
        archivedCount: archivedList.length,
        deletedCount: deletedList.length,
        archivedStudents: archivedList.map(s => s.studentId),
        deletedStudents: deletedList.map(s => s.studentId)
      },
      reason: auditReason,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Processed ${students.length} students: ${archivedList.length} safely archived with financial history preserved, ${deletedList.length} permanently deleted.`,
      data: {
        totalProcessed: students.length,
        archivedCount: archivedList.length,
        deletedCount: deletedList.length,
        archivedStudents: archivedList.map(s => ({ studentId: s.studentId, name: s.name, admissionNo: s.admissionNo })),
        deletedStudents: deletedList.map(s => ({ studentId: s.studentId, name: s.name, admissionNo: s.admissionNo }))
      }
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ==========================================
// REQUIREMENT 6: TUITION FEE CONCESSION
// ==========================================

// @desc    Get Tuition Fee concession for a student in a specific academic year
// @route   GET /api/students/:id/concession
exports.getStudentConcession = async (req, res) => {
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

    const academicYear = req.query.academicYear || student.currentAcademicYear;
    const demand = await FeeDemand.findOne({
      student: student._id,
      academicYear,
      status: 'active'
    });

    if (!demand) {
      return res.json({
        success: true,
        data: {
          hasDemand: false,
          studentName: student.name,
          admissionNo: student.admissionNo,
          course: student.course,
          studyYear: student.currentYear,
          academicYear,
          originalTuitionFee: 0,
          concessionAmount: 0,
          adjustedTuitionFee: 0,
          concession: null
        }
      });
    }

    const tuitionCategory = (demand.categories || []).find(c => (c.category || '').toLowerCase().includes('tuition'));
    const originalTuitionFee = tuitionCategory
      ? (tuitionCategory.originalAmount != null ? tuitionCategory.originalAmount : tuitionCategory.amount + (tuitionCategory.concession || demand.concession?.amount || 0))
      : (demand.concession?.originalTuitionFee || 0);

    const concessionAmount = demand.concession?.amount || (tuitionCategory?.concession || 0);
    const adjustedTuitionFee = Math.max(0, originalTuitionFee - concessionAmount);

    res.json({
      success: true,
      data: {
        hasDemand: true,
        studentName: student.name,
        admissionNo: student.admissionNo,
        course: student.course,
        studyYear: demand.year || student.currentYear,
        academicYear,
        originalTuitionFee,
        concessionAmount,
        adjustedTuitionFee,
        reason: demand.concession?.reason || '',
        appliedAt: demand.concession?.appliedAt || null,
        appliedByName: demand.concession?.appliedByName || '',
        updatedAt: demand.concession?.updatedAt || null,
        updatedByName: demand.concession?.updatedByName || ''
      }
    });
  } catch (error) {
    console.error('Get student concession error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Apply or update Tuition Fee concession on student profile
// @route   POST /api/students/:id/concession
exports.updateStudentConcession = async (req, res) => {
  try {
    const { academicYear, concessionAmount, reason } = req.body;

    const student = await Student.findOne({
      $or: [
        { studentId: req.params.id },
        { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : undefined }
      ].filter(Boolean)
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const targetAcademicYear = academicYear || student.currentAcademicYear;
    const demand = await FeeDemand.findOne({
      student: student._id,
      academicYear: targetAcademicYear,
      status: 'active'
    });

    if (!demand) {
      return res.status(400).json({
        success: false,
        message: `No active fee demand found for academic session ${targetAcademicYear}. Please configure fee structure first.`
      });
    }

    const tuitionCategory = (demand.categories || []).find(c => (c.category || '').toLowerCase().includes('tuition'));
    if (!tuitionCategory) {
      return res.status(400).json({
        success: false,
        message: `No Tuition Fee category found in the assessed fee demand for ${targetAcademicYear}. Concessions apply only to Tuition Fee.`
      });
    }

    const originalTuitionFee = tuitionCategory.originalAmount != null
      ? tuitionCategory.originalAmount
      : (tuitionCategory.amount + (tuitionCategory.concession || demand.concession?.amount || 0));

    const concession = parseFloat(concessionAmount);
    if (isNaN(concession) || concession < 0) {
      return res.status(400).json({
        success: false,
        message: 'Concession amount must be a valid non-negative number.'
      });
    }

    if (concession > originalTuitionFee) {
      return res.status(400).json({
        success: false,
        message: `Concession amount (₹${concession.toLocaleString('en-IN')}) cannot exceed the applicable Tuition Fee (₹${originalTuitionFee.toLocaleString('en-IN')}).`
      });
    }

    const adjustedTuitionFee = originalTuitionFee - concession;
    const prevConcession = demand.concession?.amount || 0;

    // Update the Tuition Fee category
    tuitionCategory.originalAmount = originalTuitionFee;
    tuitionCategory.concession = concession;
    tuitionCategory.amount = adjustedTuitionFee;

    // Update the demand concession tracking subdocument
    demand.concession = {
      amount: concession,
      originalTuitionFee,
      reason: reason ? reason.trim() : (demand.concession?.reason || ''),
      appliedAt: demand.concession?.appliedAt || new Date(),
      appliedBy: demand.concession?.appliedBy || req.user._id,
      appliedByName: demand.concession?.appliedByName || req.user.name,
      updatedAt: new Date(),
      updatedBy: req.user._id,
      updatedByName: req.user.name
    };

    // Recalculate total assessed demand
    demand.totalDemand = demand.categories.reduce((sum, c) => sum + c.amount, 0);
    await demand.save();

    // Create Audit Log
    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Tuition Fee Concession Updated',
      entity: 'FeeDemand',
      entityId: demand._id.toString(),
      description: `Applied tuition fee concession of ₹${concession.toLocaleString('en-IN')} for ${student.name} (${student.admissionNo || student.studentId}) in ${targetAcademicYear}. Original: ₹${originalTuitionFee.toLocaleString('en-IN')}, Adjusted: ₹${adjustedTuitionFee.toLocaleString('en-IN')}`,
      oldValue: { previousConcession: prevConcession },
      newValue: {
        academicYear: targetAcademicYear,
        originalTuitionFee,
        concessionAmount: concession,
        adjustedTuitionFee,
        reason: reason || ''
      },
      reason: reason || 'Tuition Fee Concession granted',
      ipAddress: req.ip
    });

    const updatedSummary = await calculateFeeSummary(student.studentId, targetAcademicYear);

    res.json({
      success: true,
      message: `Tuition Fee Concession of ₹${concession.toLocaleString('en-IN')} successfully applied. Adjusted Tuition Fee is ₹${adjustedTuitionFee.toLocaleString('en-IN')}.`,
      data: {
        academicYear: targetAcademicYear,
        originalTuitionFee,
        concessionAmount: concession,
        adjustedTuitionFee,
        concession: demand.concession,
        summary: updatedSummary
      }
    });
  } catch (error) {
    console.error('Update student concession error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * @desc    Get graduated / passed-out students with fee summaries and graduation KPIs
 * @route   GET /api/students/graduated
 * @access  Admin, Accountant
 */
exports.getGraduatedStudents = async (req, res) => {
  try {
    const {
      search,
      passingYear,
      passingAcademicYear,
      course,
      specialization,
      resultStatus,
      feeStatus,
      page = 1,
      limit = 20
    } = req.query;

    const filter = { status: 'Graduated' };

    if (search && search.trim()) {
      const sRegex = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [
        { name: sRegex },
        { studentId: sRegex },
        { admissionNo: sRegex },
        { rollNo: sRegex },
        { phone: sRegex },
        { email: sRegex },
        { course: sRegex },
        { 'graduation.academicResult.universityRegNo': sRegex }
      ];
    }

    if (passingYear && passingYear !== 'All') {
      filter['graduation.passingYear'] = parseInt(passingYear, 10);
    }

    if (passingAcademicYear && passingAcademicYear !== 'All') {
      filter['graduation.passingAcademicYear'] = passingAcademicYear.trim();
    }

    if (course && course !== 'All') {
      filter.course = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
    }

    if (specialization && specialization !== 'All') {
      filter.specialization = new RegExp(`^${escapeRegex(specialization.trim())}$`, 'i');
    }

    if (resultStatus && resultStatus !== 'All') {
      filter['graduation.academicResult.resultStatus'] = resultStatus;
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;

    const currentYear = new Date().getFullYear();

    // Concurrently fetch all matching students, all graduated for baseline KPIs, and top course
    const [allMatchingStudents, allGraduated, topCourseAgg] = await Promise.all([
      Student.find(filter)
        .sort({ 'graduation.passingYear': -1, 'graduation.graduatedAt': -1, name: 1 })
        .lean(),
      Student.find({ status: 'Graduated' }, '_id studentId graduation.passingYear').lean(),
      Student.aggregate([
        { $match: { status: 'Graduated' } },
        { $group: { _id: '$course', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
      ])
    ]);

    // Batch calculate fee summaries for all matching graduated students
    const summaryMap = await calculateBatchFeeSummaries(allMatchingStudents);

    let fullyPaidCount = 0;
    let notFullyPaidCount = 0;
    let totalOutstandingBalance = 0;
    let totalFeeAllMatching = 0;
    let totalPaidAllMatching = 0;

    const allWithDetails = allMatchingStudents.map(student => {
      const summary = summaryMap.get(student._id.toString());
      const totalFee = summary?.overall?.totalFee || 0;
      const totalPaid = summary?.overall?.totalPaid || 0;
      const totalPending = summary?.overall?.totalPending || 0;
      const fStatus = totalPending === 0 ? 'Cleared' : (totalPaid > 0 ? 'Partial' : 'Due');

      totalFeeAllMatching += totalFee;
      totalPaidAllMatching += totalPaid;

      if (totalPending > 0) {
        notFullyPaidCount++;
        totalOutstandingBalance += totalPending;
      } else {
        fullyPaidCount++;
      }

      return {
        ...student,
        totalFee,
        totalPaid,
        totalPending,
        feeStatus: fStatus
      };
    });

    // Support feeStatus filter: 'due' (only with outstanding balance) or 'paid' (only cleared)
    let filteredStudents = allWithDetails;
    if (feeStatus === 'due') {
      filteredStudents = allWithDetails.filter(s => s.totalPending > 0);
    } else if (feeStatus === 'paid' || feeStatus === 'cleared') {
      filteredStudents = allWithDetails.filter(s => s.totalPending === 0);
    }

    const total = filteredStudents.length;
    const pageStudents = filteredStudents.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const graduatedThisYear = allGraduated.filter(g => g.graduation?.passingYear === currentYear).length;
    const topCourse = topCourseAgg[0] ? `${topCourseAgg[0]._id} (${topCourseAgg[0].count})` : 'N/A';

    res.json({
      success: true,
      data: pageStudents,
      summary: {
        totalGraduated: allMatchingStudents.length,
        graduatedThisYear,
        topCourse,
        totalOutstandingBalance,
        fullyPaidCount,
        notFullyPaidCount,
        fullyPaidPercentage: allMatchingStudents.length > 0 ? Math.round((fullyPaidCount / allMatchingStudents.length) * 100) : 100,
        averageOutstandingDue: notFullyPaidCount > 0 ? Math.round(totalOutstandingBalance / notFullyPaidCount) : 0,
        totalAlumniDemanded: totalFeeAllMatching,
        totalAlumniCollected: totalPaidAllMatching,
        collectionRate: totalFeeAllMatching > 0 ? Math.round((totalPaidAllMatching / totalFeeAllMatching) * 100) : 100
      },
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum) || 1,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('Get graduated students error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * @desc    Get graduation eligibility suggestions for active students
 * @route   GET /api/students/graduation/suggestions
 * @access  Admin Only
 */
exports.getGraduationSuggestions = async (req, res) => {
  try {
    const activeStudents = await Student.find({ status: 'Active' })
      .populate('courseId')
      .sort({ course: 1, currentYear: -1, name: 1 })
      .lean();

    const currentCalendarYear = new Date().getFullYear();

    const suggestions = [];

    for (const student of activeStudents) {
      const duration = student.duration || (student.level === 'PG' ? 2 : 3);
      const yearMap = { '1st Year': 1, '2nd Year': 2, '3rd Year': 3, '4th Year': 4, '5th Year': 5, '6th Year': 6 };
      const numericYear = yearMap[student.currentYear] || 1;

      // Admission year check
      const admissionYear = student.admissionYear || student.batchStartYear || null;
      const expectedEndYear = admissionYear ? admissionYear + duration : (student.batchEndYear || null);

      let isEligible = false;
      const reasons = [];

      // Reason 1: Currently enrolled in final year or above
      if (numericYear >= duration) {
        isEligible = true;
        reasons.push(`Student is in ${student.currentYear} of a ${duration}-year course`);
      }

      // Reason 2: Expected completion year reached or passed
      if (expectedEndYear && expectedEndYear <= currentCalendarYear) {
        isEligible = true;
        reasons.push(`Course duration completed (Batch: ${student.batch || `${admissionYear}-${expectedEndYear}`})`);
      }

      if (isEligible) {
        suggestions.push({
          _id: student._id,
          studentId: student.studentId,
          admissionNo: student.admissionNo,
          name: student.name,
          course: student.course,
          specialization: student.specialization,
          level: student.level,
          currentYear: student.currentYear,
          currentAcademicYear: student.currentAcademicYear,
          admissionYear: admissionYear || (student.batchStartYear || null),
          duration,
          suggestedPassingYear: expectedEndYear || currentCalendarYear,
          suggestedPassingAcademicYear: student.currentAcademicYear || `${currentCalendarYear - 1}-${String(currentCalendarYear).slice(-2)}`,
          reasons
        });
      }
    }

    // Attach fee summary for suggested students
    const summaryMap = await calculateBatchFeeSummaries(suggestions);
    const enrichedSuggestions = suggestions.map(s => {
      const summary = summaryMap.get(s._id.toString());
      return {
        ...s,
        totalFee: summary?.overall?.totalFee || 0,
        totalPaid: summary?.overall?.totalPaid || 0,
        totalPending: summary?.overall?.totalPending || 0,
        feeStatus: summary?.overall?.status || 'No Demand'
      };
    });

    res.json({
      success: true,
      data: enrichedSuggestions,
      count: enrichedSuggestions.length
    });
  } catch (error) {
    console.error('Get graduation suggestions error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * @desc    Graduate an active student (transition to Alumni / Graduated)
 * @route   POST /api/students/:id/graduate
 * @access  Admin Only
 */
exports.graduateStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (student.status === 'Graduated') {
      return res.status(400).json({ success: false, message: 'Student is already marked as Graduated' });
    }

    const {
      passingYear,
      passingAcademicYear,
      completionDate,
      graduationRemarks,
      academicResult = {}
    } = req.body;

    const resolvedPassingYear = parseInt(passingYear, 10) || new Date().getFullYear();
    const resolvedAcademicYear = passingAcademicYear || student.currentAcademicYear || `${resolvedPassingYear - 1}-${String(resolvedPassingYear).slice(-2)}`;
    const resolvedCompletionDate = completionDate ? new Date(completionDate) : new Date();

    student.status = 'Graduated';
    student.graduation = {
      passingYear: resolvedPassingYear,
      passingAcademicYear: resolvedAcademicYear,
      completionDate: isNaN(resolvedCompletionDate.getTime()) ? new Date() : resolvedCompletionDate,
      graduatedAt: new Date(),
      graduatedBy: req.user._id,
      graduatedByName: req.user.name,
      graduationRemarks: graduationRemarks ? graduationRemarks.trim() : '',
      academicResult: {
        course: academicResult.course || student.course,
        specialization: academicResult.specialization || student.specialization,
        admissionYear: academicResult.admissionYear || student.admissionYear || student.batchStartYear,
        passingYear: academicResult.passingYear || resolvedPassingYear,
        finalSemester: academicResult.finalSemester || 'Semester VI',
        resultStatus: academicResult.resultStatus || 'Passed',
        percentage: academicResult.percentage !== undefined && academicResult.percentage !== '' ? parseFloat(academicResult.percentage) : null,
        cgpa: academicResult.cgpa !== undefined && academicResult.cgpa !== '' ? parseFloat(academicResult.cgpa) : null,
        gradeOrDivision: academicResult.gradeOrDivision || '',
        universityRegNo: academicResult.universityRegNo || '',
        resultDate: academicResult.resultDate ? new Date(academicResult.resultDate) : null,
        remarks: academicResult.remarks || ''
      },
      restorationHistory: student.graduation?.restorationHistory || []
    };

    await student.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Graduated',
      entity: 'Student',
      entityId: student._id.toString(),
      description: `Graduated student ${student.name} (${student.admissionNo || student.studentId}). Passing Year: ${resolvedPassingYear}, Academic Year: ${resolvedAcademicYear}. Financial ledger & dues preserved.`,
      newValue: {
        status: 'Graduated',
        graduation: student.graduation
      },
      reason: graduationRemarks || 'Graduation completed',
      ipAddress: req.ip
    });

    const summary = await calculateFeeSummary(student.studentId);

    res.json({
      success: true,
      message: `Student ${student.name} has been successfully graduated with passing year ${resolvedPassingYear}.`,
      data: {
        student,
        summary
      }
    });
  } catch (error) {
    console.error('Graduate student error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * @desc    Bulk graduate active students (transition to Alumni / Graduated)
 * @route   POST /api/students/bulk-graduate
 * @access  Admin Only
 */
exports.bulkGraduateStudents = async (req, res) => {
  try {
    const {
      studentIds,
      batch,
      course,
      passingYear,
      passingAcademicYear,
      completionDate,
      graduationRemarks,
      defaultResultStatus = 'Passed'
    } = req.body;

    let query = { status: { $ne: 'Graduated' } };

    if (Array.isArray(studentIds) && studentIds.length > 0) {
      query._id = { $in: studentIds };
    } else if (batch) {
      query.batch = batch;
      if (course && course !== 'All') query.course = course;
    } else {
      return res.status(400).json({ success: false, message: 'Please provide at least one student ID or a batch to graduate' });
    }

    const resolvedPassingYear = parseInt(passingYear, 10) || (batch ? parseInt(batch.split('-')[1], 10) : new Date().getFullYear()) || new Date().getFullYear();
    const resolvedCompletionDate = completionDate ? new Date(completionDate) : new Date();

    const students = await Student.find(query);

    if (students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No eligible active students found for graduation matching the criteria'
      });
    }

    const graduatedList = [];
    const now = new Date();

    for (const student of students) {
      const resolvedAcademicYear = passingAcademicYear || student.currentAcademicYear || `${resolvedPassingYear - 1}-${String(resolvedPassingYear).slice(-2)}`;

      student.status = 'Graduated';
      student.graduation = {
        passingYear: resolvedPassingYear,
        passingAcademicYear: resolvedAcademicYear,
        completionDate: isNaN(resolvedCompletionDate.getTime()) ? now : resolvedCompletionDate,
        graduatedAt: now,
        graduatedBy: req.user._id,
        graduatedByName: req.user.name,
        graduationRemarks: graduationRemarks ? graduationRemarks.trim() : 'Bulk batch graduation',
        academicResult: {
          course: student.course,
          specialization: student.specialization,
          admissionYear: student.admissionYear || student.batchStartYear,
          passingYear: resolvedPassingYear,
          finalSemester: student.level === 'PG' ? 'Semester IV' : 'Semester VI',
          resultStatus: defaultResultStatus || 'Passed',
          remarks: graduationRemarks ? graduationRemarks.trim() : ''
        },
        restorationHistory: student.graduation?.restorationHistory || []
      };

      await student.save();
      graduatedList.push({
        _id: student._id,
        studentId: student.studentId,
        admissionNo: student.admissionNo,
        name: student.name
      });
    }

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Bulk Students Graduated',
      entity: 'Student',
      entityId: `bulk-${Date.now()}`,
      description: `Bulk graduated ${graduatedList.length} students into Alumni. Passing Year: ${resolvedPassingYear}. Financial records & dues preserved.`,
      newValue: {
        graduatedCount: graduatedList.length,
        passingYear: resolvedPassingYear,
        students: graduatedList.map(s => `${s.name} (${s.admissionNo || s.studentId})`)
      },
      reason: graduationRemarks || 'Batch graduation',
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Successfully graduated ${graduatedList.length} student(s) to Alumni status with Passing Year ${resolvedPassingYear}.`,
      count: graduatedList.length,
      graduatedStudents: graduatedList
    });
  } catch (error) {
    console.error('Bulk graduate students error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * @desc    Auto-graduate all active students whose course duration / batch end year has passed
 * @route   POST /api/students/auto-graduate-past-due
 * @access  Admin Only
 */
exports.autoGraduatePastDueStudents = async (req, res) => {
  try {
    const currentCalendarYear = new Date().getFullYear();
    const activeStudents = await Student.find({ status: 'Active' });

    const eligibleToGraduate = [];
    for (const student of activeStudents) {
      const duration = student.duration || (student.level === 'PG' ? 2 : 3);
      const admissionYear = student.admissionYear || student.batchStartYear || null;
      const expectedEndYear = admissionYear ? admissionYear + duration : (student.batchEndYear || null);

      // If expected completion year has passed or is reached
      if (expectedEndYear && expectedEndYear <= currentCalendarYear) {
        eligibleToGraduate.push({
          student,
          expectedEndYear,
          passingAcademicYear: `${expectedEndYear - 1}-${String(expectedEndYear).slice(-2)}`
        });
      }
    }

    if (eligibleToGraduate.length === 0) {
      return res.json({
        success: true,
        message: 'No past-due active students found. All student cohorts are up to date!',
        count: 0,
        graduatedStudents: []
      });
    }

    const graduatedList = [];
    const now = new Date();

    for (const item of eligibleToGraduate) {
      const { student, expectedEndYear, passingAcademicYear } = item;

      student.status = 'Graduated';
      student.graduation = {
        passingYear: expectedEndYear,
        passingAcademicYear,
        completionDate: new Date(`${expectedEndYear}-06-30`),
        graduatedAt: now,
        graduatedBy: req.user._id,
        graduatedByName: req.user.name,
        graduationRemarks: `Auto-graduated based on course duration completion (Batch: ${student.batch || `${student.admissionYear || expectedEndYear - (student.duration || 3)}-${expectedEndYear}`})`,
        academicResult: {
          course: student.course,
          specialization: student.specialization,
          admissionYear: student.admissionYear || student.batchStartYear || (expectedEndYear - (student.duration || 3)),
          passingYear: expectedEndYear,
          finalSemester: student.level === 'PG' ? 'Semester IV' : 'Semester VI',
          resultStatus: 'Passed',
          remarks: 'Auto-graduated at course completion'
        },
        restorationHistory: student.graduation?.restorationHistory || []
      };

      await student.save();
      graduatedList.push({
        _id: student._id,
        studentId: student.studentId,
        admissionNo: student.admissionNo,
        name: student.name,
        batch: student.batch,
        passingYear: expectedEndYear
      });
    }

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Auto-Graduated Past-Due Batches',
      entity: 'Student',
      entityId: `auto-grad-${Date.now()}`,
      description: `Auto-graduated ${graduatedList.length} past-due students across batches into Alumni records. All financial dues and receipts preserved.`,
      newValue: {
        graduatedCount: graduatedList.length,
        students: graduatedList.map(s => `${s.name} (${s.admissionNo || s.studentId}, Class of ${s.passingYear})`)
      },
      reason: 'Automated batch duration progression',
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Successfully auto-graduated ${graduatedList.length} past-due student(s) into Alumni records.`,
      count: graduatedList.length,
      graduatedStudents: graduatedList
    });
  } catch (error) {
    console.error('Auto graduate past-due students error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * @desc    Restore a graduated student back to Active status
 * @route   POST /api/students/:id/restore
 * @access  Admin Only
 */
exports.restoreStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (student.status !== 'Graduated') {
      return res.status(400).json({ success: false, message: `Only graduated students can be restored. Current status is "${student.status}".` });
    }

    const { reason, targetYear, targetAcademicYear } = req.body;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'A mandatory reason (minimum 5 characters) is required to restore a graduated student.'
      });
    }

    const prevGraduation = student.graduation ? student.graduation.toObject() : {};

    student.status = 'Active';
    if (targetYear) student.currentYear = targetYear;
    if (targetAcademicYear) student.currentAcademicYear = targetAcademicYear;

    if (!student.graduation) {
      student.graduation = {};
    }
    if (!student.graduation.restorationHistory) {
      student.graduation.restorationHistory = [];
    }

    student.graduation.restorationHistory.push({
      restoredAt: new Date(),
      restoredBy: req.user._id,
      restoredByName: req.user.name,
      reason: reason.trim(),
      previousStatus: 'Graduated'
    });

    await student.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Student Restored from Graduation',
      entity: 'Student',
      entityId: student._id.toString(),
      description: `Restored ${student.name} (${student.admissionNo || student.studentId}) from Graduated to Active status. Reason: ${reason.trim()}`,
      oldValue: { status: 'Graduated', graduation: prevGraduation },
      newValue: {
        status: 'Active',
        currentYear: student.currentYear,
        currentAcademicYear: student.currentAcademicYear,
        restoredBy: req.user.name,
        restorationReason: reason.trim()
      },
      reason: reason.trim(),
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Student ${student.name} has been restored to Active status.`,
      data: student
    });
  } catch (error) {
    console.error('Restore student error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * @desc    Update academic results for a graduated student
 * @route   PUT /api/students/:id/academic-results
 * @access  Admin Only
 */
exports.updateAcademicResults = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const {
      course,
      specialization,
      admissionYear,
      passingYear,
      finalSemester,
      resultStatus,
      percentage,
      cgpa,
      gradeOrDivision,
      universityRegNo,
      resultDate,
      remarks
    } = req.body;

    if (!student.graduation) {
      student.graduation = {
        passingYear: passingYear || new Date().getFullYear(),
        completionDate: new Date()
      };
    }

    const prevResult = student.graduation.academicResult ? student.graduation.academicResult.toObject() : {};

    student.graduation.academicResult = {
      course: course || student.graduation.academicResult?.course || student.course,
      specialization: specialization || student.graduation.academicResult?.specialization || student.specialization,
      admissionYear: admissionYear !== undefined ? admissionYear : (student.graduation.academicResult?.admissionYear || student.admissionYear),
      passingYear: passingYear !== undefined ? parseInt(passingYear, 10) : (student.graduation.academicResult?.passingYear || student.graduation.passingYear),
      finalSemester: finalSemester || student.graduation.academicResult?.finalSemester || 'Final Semester',
      resultStatus: resultStatus || student.graduation.academicResult?.resultStatus || 'Passed',
      percentage: percentage !== undefined ? (percentage === '' ? null : parseFloat(percentage)) : student.graduation.academicResult?.percentage,
      cgpa: cgpa !== undefined ? (cgpa === '' ? null : parseFloat(cgpa)) : student.graduation.academicResult?.cgpa,
      gradeOrDivision: gradeOrDivision !== undefined ? gradeOrDivision : student.graduation.academicResult?.gradeOrDivision,
      universityRegNo: universityRegNo !== undefined ? universityRegNo : student.graduation.academicResult?.universityRegNo,
      resultDate: resultDate ? new Date(resultDate) : (student.graduation.academicResult?.resultDate || null),
      remarks: remarks !== undefined ? remarks : student.graduation.academicResult?.remarks
    };

    if (passingYear) {
      student.graduation.passingYear = parseInt(passingYear, 10);
    }

    await student.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Academic Results Updated',
      entity: 'Student',
      entityId: student._id.toString(),
      description: `Updated academic results for graduated student ${student.name} (${student.admissionNo || student.studentId}). Status: ${student.graduation.academicResult.resultStatus}, Percentage: ${student.graduation.academicResult.percentage}%`,
      oldValue: prevResult,
      newValue: student.graduation.academicResult,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Academic results for ${student.name} updated successfully.`,
      data: student.graduation.academicResult
    });
  } catch (error) {
    console.error('Update academic results error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

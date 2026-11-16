const ExcelJS = require('exceljs');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Payment = require('../models/Payment');
const FeeStructure = require('../models/FeeStructure');
const FeeDemand = require('../models/FeeDemand');
const AcademicYear = require('../models/AcademicYear');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { calculateFeeSummary, calculateBatchFeeSummaries } = require('../utils/feeCalculator');
const { createAuditLog } = require('../utils/helpers');

const escapeRegex = (s) => (s ? s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : '');

// Safe dash normalizer for matching hyphen variations (-, –, —) in batches and academic years
const normalizeDashRegex = (s) => {
  if (!s) return '';
  const escaped = s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(/[-–—]/g, '[-–—]');
};

// Category normalizer helper: maps standard variants to clean canonical names
const normalizeCategoryName = (cat) => {
  if (!cat) return '';
  const trimmed = cat.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'laboratory fee' || lower === 'lab fee') return 'Lab Fee';
  if (lower === 'university development fee (udf)' || lower === 'udf fee' || lower === 'udf') return 'UDF Fee';
  if (lower === 'examination fee' || lower === 'exam fee') return 'Exam Fee';
  if (lower === 'tuition fee') return 'Tuition Fee';
  if (lower === 'practical fee') return 'Practical Fee';
  return trimmed;
};

// Formula injection sanitizer (prevents Excel execution of =, +, -, @, \t, \r)
function sanitizeCell(val) {
  if (val == null) return '';
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (val instanceof Date) return val.toLocaleDateString('en-IN');
  const str = String(val).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

// Format date helper
function formatDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-IN');
  } catch {
    return '';
  }
}

// Build query filter from request parameters
function buildStudentFilter(query) {
  const {
    academicYear,
    course,
    studyYear,
    status,
    search,
    studentIds,
    scope
  } = query;

  const filter = {};

  if (studentIds) {
    const ids = Array.isArray(studentIds)
      ? studentIds
      : studentIds.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      filter.$or = [
        { studentId: { $in: ids } },
        { _id: { $in: ids.filter(id => id.match(/^[0-9a-fA-F]{24}$/)) } }
      ];
    }
  }

  if (course && course !== 'All') {
    filter.course = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
  }

  if (studyYear && studyYear !== 'All') {
    filter.currentYear = new RegExp(`^${escapeRegex(studyYear.trim())}$`, 'i');
  }

  if (status && status !== 'All') {
    filter.status = status;
  }

  if (academicYear && academicYear !== 'All') {
    filter.currentAcademicYear = academicYear.trim();
  }

  if (search && search.trim()) {
    const sRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchConditions = [
      { name: sRegex },
      { admissionNo: sRegex },
      { studentId: sRegex },
      { email: sRegex },
      { phone: sRegex }
    ];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
      delete filter.$or;
    } else {
      filter.$or = searchConditions;
    }
  }

  return filter;
}

// @desc    Preview record count & financial totals for Master Workbook filters
// @route   GET /api/exports/master-workbook/count
exports.getMasterWorkbookCount = async (req, res) => {
  try {
    const filter = buildStudentFilter(req.query);
    const count = await Student.countDocuments(filter);
    
    // Quick sample aggregate of fees and payments
    const matchingStudents = await Student.find(filter, '_id studentId').lean();
    const studentIds = matchingStudents.map(s => s._id);

    const [demandsCount, paymentsCount, demandsAgg, paymentsAgg] = await Promise.all([
      FeeDemand.countDocuments({ student: { $in: studentIds }, status: 'active' }),
      Payment.countDocuments({ student: { $in: studentIds }, status: 'completed' }),
      FeeDemand.aggregate([
        { $match: { student: { $in: studentIds }, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$totalDemand' } } }
      ]),
      Payment.aggregate([
        { $match: { student: { $in: studentIds }, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amountPaid' } } }
      ])
    ]);

    const totalFeeAssessed = demandsAgg[0]?.total || 0;
    const totalPaid = paymentsAgg[0]?.total || 0;
    const totalPending = Math.max(0, totalFeeAssessed - totalPaid);

    res.json({
      success: true,
      data: {
        count,
        matchingStudents: count,
        matchingDemands: demandsCount,
        matchingPayments: paymentsCount,
        totalAssessed: totalFeeAssessed,
        totalFeeAssessed,
        totalPaid,
        totalPending
      }
    });
  } catch (error) {
    console.error('Count export error:', error);
    res.status(500).json({ success: false, message: 'Failed to preview count' });
  }
};

// @desc    Export Master Workbook with rich filters and 5 specialized sheets
// @route   GET /api/exports/master-workbook
exports.exportMasterWorkbook = async (req, res) => {
  try {
    const filter = buildStudentFilter(req.query);
    const { calendarYear, academicYear } = req.query;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sri Sai Degree & PG College Fee Management System';
    workbook.created = new Date();

    const students = await Student.find(filter).sort({ studentId: 1 }).lean();
    const studentObjectIds = students.map(s => s._id);

    // Concurrently fetch demands, completed payments, and academic years
    const [allDemands, allPayments, academicYearsList] = await Promise.all([
      FeeDemand.find({
        student: { $in: studentObjectIds },
        status: 'active'
      }).sort({ academicYear: 1 }).lean(),
      Payment.find({
        student: { $in: studentObjectIds },
        status: 'completed'
      }).sort({ paymentDate: -1 }).lean(),
      AcademicYear.find().sort({ year: -1, course: 1, studyYear: 1 }).lean()
    ]);

    // Group by student
    const demandsByStudent = new Map();
    for (const d of allDemands) {
      const key = d.student.toString();
      if (!demandsByStudent.has(key)) demandsByStudent.set(key, []);
      demandsByStudent.get(key).push(d);
    }

    const paymentsByStudent = new Map();
    for (const p of allPayments) {
      const key = p.student.toString();
      if (!paymentsByStudent.has(key)) paymentsByStudent.set(key, []);
      paymentsByStudent.get(key).push(p);
    }

    // Sheet 1: Student_Master
    const masterSheet = workbook.addWorksheet('Student_Master', { views: [{ state: 'frozen', ySplit: 1 }] });
    masterSheet.columns = [
      { header: 'Admission No', key: 'admissionNo', width: 18 },
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Profile Photo URL', key: 'profilePhoto', width: 25 },
      { header: 'Course / Branch', key: 'course', width: 24 },
      { header: 'Specialization', key: 'specialization', width: 20 },
      { header: 'Study Year', key: 'currentYear', width: 14 },
      { header: 'Academic Year', key: 'currentAcademicYear', width: 16 },
      { header: 'Admission Year', key: 'admissionYear', width: 16 },
      { header: 'Batch', key: 'batch', width: 14 },
      { header: 'Student Status', key: 'status', width: 14 },
      { header: 'Group / Level', key: 'level', width: 14 },
      { header: 'Father Name', key: 'fatherName', width: 22 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Address', key: 'address', width: 30 },
      { header: 'Original Tuition Fee', key: 'originalTuitionFee', width: 20 },
      { header: 'Tuition Fee Concession', key: 'concession', width: 22 },
      { header: 'Adjusted Tuition Fee', key: 'adjustedTuitionFee', width: 20 },
      { header: 'UDF Fee', key: 'udfFee', width: 14 },
      { header: 'Exam Fee', key: 'examFee', width: 14 },
      { header: 'Practical Fee', key: 'practicalFee', width: 16 },
      { header: 'Other Fees', key: 'otherFee', width: 14 },
      { header: 'Total Fee Assessed', key: 'totalFee', width: 18 },
      { header: 'Total Amount Paid', key: 'totalPaid', width: 18 },
      { header: 'Total Outstanding Balance', key: 'totalPending', width: 24 },
      { header: 'Advance Credit', key: 'advanceCredit', width: 16 },
      { header: 'Last Payment Date', key: 'lastPaymentDate', width: 18 }
    ];

    let grandAssessed = 0;
    let grandPaid = 0;
    let grandPending = 0;

    for (const student of students) {
      const sId = student._id.toString();
      const sDemands = demandsByStudent.get(sId) || [];
      const sPayments = paymentsByStudent.get(sId) || [];

      // Category breakdown for current session
      const targetAy = academicYear && academicYear !== 'All' ? academicYear : student.currentAcademicYear;
      const relevantDemand = sDemands.find(d => d.academicYear === targetAy) || sDemands[sDemands.length - 1];

      let originalTuition = 0;
      let concessionAmt = 0;
      let adjustedTuition = 0;
      let udfFee = 0;
      let examFee = 0;
      let practicalFee = 0;
      let otherFee = 0;

      if (relevantDemand && relevantDemand.categories) {
        for (const cat of relevantDemand.categories) {
          const cName = (cat.category || '').toLowerCase();
          if (cName.includes('tuition')) {
            const base = cat.originalAmount != null ? cat.originalAmount : (cat.amount + (cat.concession || relevantDemand.concession?.amount || 0));
            const con = cat.concession || relevantDemand.concession?.amount || 0;
            originalTuition += base;
            concessionAmt += con;
            adjustedTuition += (base - con);
          } else if (cName.includes('udf')) {
            udfFee += cat.amount;
          } else if (cName.includes('exam')) {
            examFee += cat.amount;
          } else if (cName.includes('practical')) {
            practicalFee += cat.amount;
          } else {
            otherFee += cat.amount;
          }
        }
      }

      // Aggregate student financials across demands and valid payments
      const totalFee = sDemands.reduce((sum, d) => sum + (d.totalDemand || 0), 0);
      
      // Filter payments by calendarYear if requested
      const validPayments = sPayments.filter(p => {
        if (calendarYear && calendarYear !== 'All') {
          return new Date(p.paymentDate).getFullYear() === parseInt(calendarYear);
        }
        return true;
      });

      const totalPaid = validPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
      const totalPending = Math.max(0, totalFee - totalPaid);
      const advanceCredit = totalPaid > totalFee ? totalPaid - totalFee : (student.advanceCredit || 0);

      const lastPayment = validPayments.length > 0 ? validPayments[0] : null;
      const lastPaymentDate = lastPayment ? formatDate(lastPayment.paymentDate) : 'No payments';

      // Admission year derived from batch or admissionNo
      let admYear = '';
      if (student.batchStartYear) admYear = String(student.batchStartYear);
      else if (student.admissionNo) {
        const m = student.admissionNo.match(/\d{4}/);
        if (m) admYear = m[0];
      }

      masterSheet.addRow({
        admissionNo: sanitizeCell(student.admissionNo),
        name: sanitizeCell(student.name),
        profilePhoto: sanitizeCell(student.profilePhoto || 'None'),
        course: sanitizeCell(student.course),
        specialization: sanitizeCell(student.specialization || student.course),
        currentYear: sanitizeCell(student.currentYear),
        currentAcademicYear: sanitizeCell(student.currentAcademicYear),
        admissionYear: sanitizeCell(admYear),
        batch: sanitizeCell(student.batch || '-'),
        status: sanitizeCell(student.status),
        level: sanitizeCell(student.level),
        fatherName: sanitizeCell(student.fatherName || '-'),
        email: sanitizeCell(student.email || '-'),
        phone: sanitizeCell(student.phone || '-'),
        gender: sanitizeCell(student.gender || '-'),
        address: sanitizeCell(student.address || '-'),
        originalTuitionFee: originalTuition,
        concession: concessionAmt,
        adjustedTuitionFee: adjustedTuition,
        udfFee,
        examFee,
        practicalFee,
        otherFee,
        totalFee,
        totalPaid,
        totalPending,
        advanceCredit,
        lastPaymentDate: sanitizeCell(lastPaymentDate)
      });

      grandAssessed += totalFee;
      grandPaid += totalPaid;
      grandPending += totalPending;
    }
    styleWorksheet(masterSheet);

    // Sheet 2: Fee_Details
    const detailsSheet = workbook.addWorksheet('Fee_Details', { views: [{ state: 'frozen', ySplit: 1 }] });
    detailsSheet.columns = [
      { header: 'Admission No', key: 'admissionNo', width: 18 },
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Course', key: 'course', width: 24 },
      { header: 'Academic Year', key: 'academicYear', width: 16 },
      { header: 'Study Year', key: 'year', width: 14 },
      { header: 'Fee Category', key: 'category', width: 20 },
      { header: 'Semester', key: 'semester', width: 14 },
      { header: 'Frequency', key: 'frequency', width: 14 },
      { header: 'Assessed Amount', key: 'originalAmount', width: 18 },
      { header: 'Concession', key: 'concession', width: 16 },
      { header: 'Net Amount', key: 'amount', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Due Date', key: 'dueDate', width: 16 }
    ];

    for (const student of students) {
      const sDemands = demandsByStudent.get(student._id.toString()) || [];
      for (const demand of sDemands) {
        if (demand.categories && demand.categories.length > 0) {
          for (const cat of demand.categories) {
            const isTuition = (cat.category || '').toLowerCase().includes('tuition');
            const con = isTuition ? (cat.concession || demand.concession?.amount || 0) : (cat.concession || 0);
            const orig = cat.originalAmount != null ? cat.originalAmount : (con > 0 ? cat.amount + con : cat.amount);

            detailsSheet.addRow({
              admissionNo: sanitizeCell(student.admissionNo),
              name: sanitizeCell(student.name),
              course: sanitizeCell(demand.course || student.course),
              academicYear: sanitizeCell(demand.academicYear),
              year: sanitizeCell(demand.year),
              category: sanitizeCell(cat.category),
              semester: sanitizeCell(cat.semester || 'Annual'),
              frequency: sanitizeCell(cat.frequency || 'ANNUAL'),
              originalAmount: orig,
              concession: con,
              amount: cat.amount,
              status: sanitizeCell(cat.status || 'active'),
              dueDate: sanitizeCell(formatDate(cat.dueDate))
            });
          }
        }
      }
    }
    styleWorksheet(detailsSheet);

    // Sheet 3: Payment_History
    const paymentSheet = workbook.addWorksheet('Payment_History', { views: [{ state: 'frozen', ySplit: 1 }] });
    paymentSheet.columns = [
      { header: 'Receipt No', key: 'receiptNo', width: 18 },
      { header: 'Admission No', key: 'admissionNo', width: 18 },
      { header: 'Student Name', key: 'studentName', width: 25 },
      { header: 'Course', key: 'course', width: 24 },
      { header: 'Academic Year', key: 'academicYear', width: 16 },
      { header: 'Study Year', key: 'year', width: 14 },
      { header: 'Payment Date', key: 'paymentDate', width: 16 },
      { header: 'Amount Paid', key: 'amountPaid', width: 16 },
      { header: 'Payment Mode', key: 'paymentMode', width: 16 },
      { header: 'Transaction ID', key: 'transactionId', width: 20 },
      { header: 'Allocations / Category', key: 'feeCategory', width: 26 },
      { header: 'Entered By', key: 'enteredByName', width: 18 },
      { header: 'Status', key: 'status', width: 14 }
    ];

    const studentMap = new Map(students.map(s => [s._id.toString(), s]));
    for (const p of allPayments) {
      const student = studentMap.get(p.student.toString());
      if (student) {
        if (calendarYear && calendarYear !== 'All') {
          if (new Date(p.paymentDate).getFullYear() !== parseInt(calendarYear)) {
            continue;
          }
        }

        const allocDesc = p.allocations && p.allocations.length > 0
          ? p.allocations.map(a => `${a.category}: ₹${a.amount}`).join(', ')
          : (p.feeCategory || 'General Fee Payment');

        paymentSheet.addRow({
          receiptNo: sanitizeCell(p.receiptNo),
          admissionNo: sanitizeCell(student.admissionNo),
          studentName: sanitizeCell(student.name),
          course: sanitizeCell(student.course),
          academicYear: sanitizeCell(p.academicYear),
          year: sanitizeCell(p.year),
          paymentDate: sanitizeCell(formatDate(p.paymentDate)),
          amountPaid: p.amountPaid,
          paymentMode: sanitizeCell(p.paymentMode),
          transactionId: sanitizeCell(p.transactionId || '-'),
          feeCategory: sanitizeCell(allocDesc),
          enteredByName: sanitizeCell(p.enteredByName || 'Accountant'),
          status: sanitizeCell(p.status)
        });
      }
    }
    styleWorksheet(paymentSheet);

    // Sheet 4: Academic_Years
    const aySheet = workbook.addWorksheet('Academic_Years', { views: [{ state: 'frozen', ySplit: 1 }] });
    aySheet.columns = [
      { header: 'Academic Year', key: 'year', width: 16 },
      { header: 'Course / Branch', key: 'course', width: 24 },
      { header: 'Study Year', key: 'studyYear', width: 16 },
      { header: 'Start Date', key: 'startDate', width: 16 },
      { header: 'End Date', key: 'endDate', width: 16 },
      { header: 'Fee Activation Date', key: 'feeActivationDate', width: 20 },
      { header: 'Fee Due Date', key: 'feeDueDate', width: 18 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Active Current', key: 'isCurrent', width: 16 }
    ];

    for (const ay of academicYearsList) {
      aySheet.addRow({
        year: sanitizeCell(ay.year),
        course: sanitizeCell(ay.course || 'All Courses'),
        studyYear: sanitizeCell(ay.studyYear || 'All Study Years'),
        startDate: sanitizeCell(formatDate(ay.startDate)),
        endDate: sanitizeCell(formatDate(ay.endDate)),
        feeActivationDate: sanitizeCell(formatDate(ay.feeActivationDate)),
        feeDueDate: sanitizeCell(formatDate(ay.feeDueDate)),
        status: sanitizeCell(ay.status),
        isCurrent: ay.isCurrent ? 'Yes' : 'No'
      });
    }
    styleWorksheet(aySheet);

    // Sheet 5: Export_Summary
    const summarySheet = workbook.addWorksheet('Export_Summary');
    summarySheet.columns = [
      { header: 'Parameter / Metric', key: 'metric', width: 32 },
      { header: 'Configured Value', key: 'value', width: 36 }
    ];

    summarySheet.addRow({ metric: 'Institution Name', value: 'Sri Sai Degree & PG College' });
    summarySheet.addRow({ metric: 'Export Generated By', value: `${req.user?.name || 'Administrator'} (${req.user?.role || 'admin'})` });
    summarySheet.addRow({ metric: 'Generation Timestamp', value: new Date().toLocaleString('en-IN') });
    summarySheet.addRow({ metric: 'Filter: Academic Year', value: academicYear || 'All Academic Years' });
    summarySheet.addRow({ metric: 'Filter: Calendar Year', value: calendarYear || 'All Calendar Years' });
    summarySheet.addRow({ metric: 'Filter: Course / Branch', value: req.query.course || 'All Courses' });
    summarySheet.addRow({ metric: 'Filter: Study Year', value: req.query.studyYear || 'All Study Years' });
    summarySheet.addRow({ metric: 'Filter: Student Status', value: req.query.status || 'All Statuses' });
    summarySheet.addRow({ metric: 'Filter: Search Query', value: req.query.search || 'None' });
    summarySheet.addRow({ metric: 'Total Matching Students Exported', value: students.length });
    summarySheet.addRow({ metric: 'Total Fee Assessed (Gross)', value: `₹${grandAssessed.toLocaleString('en-IN')}` });
    summarySheet.addRow({ metric: 'Total Payments Collected', value: `₹${grandPaid.toLocaleString('en-IN')}` });
    summarySheet.addRow({ metric: 'Total Outstanding Balance Due', value: `₹${grandPending.toLocaleString('en-IN')}` });
    styleWorksheet(summarySheet);

    // Audit Log entry
    await createAuditLog({
      user: req.user?._id,
      userName: req.user?.name || 'Administrator',
      userRole: req.user?.role || 'admin',
      action: 'Master Workbook Exported',
      entity: 'Student',
      description: `Generated Master Workbook export with ${students.length} students matching filters`,
      newValue: {
        totalStudents: students.length,
        filters: req.query
      },
      reason: 'Administrator downloaded Excel Master Workbook report',
      ipAddress: req.ip
    });

    const filename = `Fee_Master_Workbook_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export master workbook error:', error);
    res.status(500).json({ success: false, message: 'Master workbook generation failed' });
  }
};

/**
 * Helper to fetch and calculate pending fee export rows with strict multi-year separation
 */
async function fetchPendingFeeExportData({
  academicYear,
  course,
  degree,
  level,
  studyYear,
  year,
  batch,
  search,
  studentIds,
  onlyDefaulters = 'true'
}) {
  const filter = {};

  // 1. Student selection filter (bulk selection)
  if (studentIds) {
    const ids = Array.isArray(studentIds)
      ? studentIds
      : studentIds.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      filter.$or = [
        { studentId: { $in: ids } },
        { _id: { $in: ids.filter(id => id.match(/^[0-9a-fA-F]{24}$/)) } }
      ];
    }
  }

  if (course && course !== 'All') {
    filter.course = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
  }

  if (degree && degree !== 'All') {
    filter.degree = new RegExp(`^${escapeRegex(degree.trim())}$`, 'i');
  }

  if (level && level !== 'All') {
    filter.level = level.trim();
  }

  const yr = studyYear || year;
  if (yr && yr !== 'All') {
    filter.currentYear = new RegExp(`^${escapeRegex(yr.trim())}$`, 'i');
  }

  if (batch && batch !== 'All') {
    const normalizedBatch = normalizeDashRegex(batch);
    filter.batch = new RegExp(`^${normalizedBatch}$`, 'i');
  }

  // Default to Active students unless specified otherwise
  if (!filter.status) {
    filter.status = 'Active';
  }

  if (search && search.trim()) {
    const trimmed = search.trim();
    const escaped = escapeRegex(trimmed);
    const sRegex = new RegExp(escaped, 'i');
    const words = trimmed.split(/\s+/).filter(Boolean).map(escapeRegex);
    const multiWordRegex = new RegExp(words.map(w => `(?=.*${w})`).join(''), 'i');

    const searchConditions = [
      { name: multiWordRegex },
      { name: sRegex },
      { studentId: sRegex },
      { admissionNo: sRegex },
      { rollNo: sRegex },
      { phone: sRegex }
    ];

    if (trimmed.length >= 3) {
      searchConditions.push({ course: sRegex });
      searchConditions.push({ specialization: sRegex });
    }

    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
      delete filter.$or;
    } else {
      filter.$or = searchConditions;
    }
  }

  // Fetch matching students
  const students = await Student.find(filter).sort({ currentYear: 1, admissionNo: 1, name: 1 }).lean();
  const studentObjectIds = students.map(s => s._id);

  if (students.length === 0) {
    return {
      dataRows: [],
      sortedCategories: ['Tuition Fee', 'Lab Fee', 'UDF Fee', 'Practical Fee', 'Exam Fee'],
      rawStudentCount: 0
    };
  }

  // Concurrently fetch demands, payments, and active FeeStructures
  const demandQuery = {
    student: { $in: studentObjectIds },
    status: 'active'
  };
  if (academicYear && academicYear !== 'All') {
    const normalizedAy = normalizeDashRegex(academicYear);
    demandQuery.academicYear = new RegExp(`^${normalizedAy}$`, 'i');
  }

  const paymentQuery = {
    student: { $in: studentObjectIds },
    status: 'completed'
  };

  const fsQuery = { status: 'active' };
  if (academicYear && academicYear !== 'All') {
    const normalizedAy = normalizeDashRegex(academicYear);
    fsQuery.academicYear = new RegExp(`^${normalizedAy}$`, 'i');
  }

  const [allDemands, allPayments, allFeeStructures] = await Promise.all([
    FeeDemand.find(demandQuery).sort({ academicYear: 1 }).lean(),
    Payment.find(paymentQuery).sort({ paymentDate: 1 }).lean(),
    FeeStructure.find(fsQuery).sort({ course: 1, year: 1, category: 1 }).lean()
  ]);

  // Group demands and payments by student ObjectId
  const demandsByStudent = new Map();
  for (const d of allDemands) {
    const key = d.student.toString();
    if (!demandsByStudent.has(key)) demandsByStudent.set(key, []);
    demandsByStudent.get(key).push(d);
  }

  const paymentsByStudent = new Map();
  for (const p of allPayments) {
    const key = p.student.toString();
    if (!paymentsByStudent.has(key)) paymentsByStudent.set(key, []);
    paymentsByStudent.get(key).push(p);
  }

  // Build lookup map for FeeStructures by course + year + academicYear
  const structMap = new Map();
  const allCategorySet = new Set();

  for (const fs of allFeeStructures) {
    const cKey = (fs.course || '').trim().toLowerCase();
    const yKey = (fs.year || '').trim().toLowerCase();
    const ayKey = (fs.academicYear || '').replace(/[-–—]/g, '-').trim().toLowerCase();
    const mapKey = `${cKey}_${yKey}_${ayKey}`;

    if (!structMap.has(mapKey)) structMap.set(mapKey, new Map());
    const normCat = normalizeCategoryName(fs.category);
    if (normCat) {
      allCategorySet.add(normCat);
      const curAmt = structMap.get(mapKey).get(normCat.toLowerCase()) || 0;
      structMap.get(mapKey).set(normCat.toLowerCase(), curAmt + (fs.amount || 0));
    }
  }

  // Also collect categories from active student demands
  for (const d of allDemands) {
    if (d.categories && Array.isArray(d.categories)) {
      for (const c of d.categories) {
        const normCat = normalizeCategoryName(c.category);
        if (normCat) allCategorySet.add(normCat);
      }
    }
  }

  // Ordered priority categories
  const canonOrder = ['Tuition Fee', 'Lab Fee', 'UDF Fee', 'Practical Fee', 'Exam Fee'];
  const sortedCategories = [];
  for (const canon of canonOrder) {
    sortedCategories.push(canon);
    allCategorySet.delete(canon);
  }
  const otherCategories = Array.from(allCategorySet).sort();
  sortedCategories.push(...otherCategories);

  // Build data rows (one row per student for the selected academic year)
  const dataRows = [];
  const filterDefaultersOnly = onlyDefaulters === 'true' || onlyDefaulters === true;

  for (const student of students) {
    const sId = student._id.toString();
    const sDemands = demandsByStudent.get(sId) || [];
    const sPayments = paymentsByStudent.get(sId) || [];

    const targetDemands = sDemands.length > 0 ? sDemands : [{
      academicYear: academicYear && academicYear !== 'All' ? academicYear.trim() : (student.currentAcademicYear || '2026-27'),
      year: student.currentYear || '1st Year',
      categories: [],
      totalDemand: 0,
      concession: { amount: 0 }
    }];

    for (const demand of targetDemands) {
      const dAy = demand.academicYear || (academicYear && academicYear !== 'All' ? academicYear.trim() : (student.currentAcademicYear || '2026-27'));
      const sYear = demand.year || student.currentYear || '1st Year';
      const sCourse = (student.course || student.specialization || '').trim();

      const dAyNorm = dAy.replace(/[-–—]/g, '-').trim().toLowerCase();
      const mapKey = `${sCourse.toLowerCase()}_${sYear.toLowerCase()}_${dAyNorm}`;
      const fsCatMap = structMap.get(mapKey) || new Map();

      // Payments for this academic year (strict multi-year separation)
      const yearPayments = sPayments.filter(p => {
        if (!p.academicYear) return false;
        const pAy = p.academicYear.replace(/[-–—]/g, '-').trim();
        const targetAy = dAy.replace(/[-–—]/g, '-').trim();
        return pAy === targetAy && p.status === 'completed';
      });
      const totalPaid = yearPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);

      // Concession for this academic year
      const concession = demand.concession?.amount || 0;

      // Resolve original assessed fee amount for each category (EXACTLY ONE column per category)
      const categoryOriginalAmounts = {};
      let rowAssessedTotal = 0;

      for (const cat of sortedCategories) {
        const lKey = cat.toLowerCase();
        let amount = 0;

        // 1. Check student-specific demand categories first
        if (demand.categories && Array.isArray(demand.categories)) {
          const matchingDCats = demand.categories.filter(c =>
            normalizeCategoryName(c.category).toLowerCase() === lKey
          );

          if (matchingDCats.length > 0) {
            for (const mdc of matchingDCats) {
              let origAmt = 0;
              if (mdc.originalAmount != null && mdc.originalAmount > 0) {
                origAmt = mdc.originalAmount;
              } else if (mdc.concession && mdc.concession > 0) {
                origAmt = mdc.amount + mdc.concession;
              } else if (lKey.includes('tuition') && concession > 0) {
                origAmt = demand.concession?.originalTuitionFee || (mdc.amount + concession);
              } else {
                origAmt = mdc.amount || 0;
              }
              amount += origAmt;
            }
          }
        }

        // 2. Fallback to Admin Fee Structure if amount is still 0
        if (amount === 0 && fsCatMap.has(lKey)) {
          amount = fsCatMap.get(lKey) || 0;
        }

        categoryOriginalAmounts[cat] = amount;
        rowAssessedTotal += amount;
      }

      // Financial summary calculations
      const finalAssessed = Math.max(rowAssessedTotal, (demand.totalDemand || 0) + concession);
      const netAssessed = Math.max(0, finalAssessed - concession);
      const remainingBalance = Math.max(0, netAssessed - totalPaid);

      // Defaulter filter check: skip only if explicitly requested and student has ₹0 remaining due
      if (filterDefaultersOnly && !studentIds && remainingBalance === 0) {
        continue;
      }

      dataRows.push({
        rollNumber: student.rollNo || student.admissionNo || '—',
        name: student.name,
        level: student.level || 'UG',
        degree: student.degree || (student.course ? student.course.split(' ')[0] : '—'),
        course: student.course || student.specialization || '—',
        studyYear: sYear,
        academicYear: dAy,
        batch: student.batch || '—',
        categories: categoryOriginalAmounts,
        totalAssessed: finalAssessed,
        concession,
        totalPaid,
        remainingBalance
      });
    }
  }

  return {
    dataRows,
    sortedCategories,
    rawStudentCount: students.length
  };
}

/**
 * @desc    Get Live Preview and Summary Count for Pending Fee Excel Download Dialog
 * @route   GET /api/exports/pending-fees/preview
 * @access  Private (Admin & Accountant)
 */
exports.previewPendingFeesExport = async (req, res) => {
  try {
    const {
      academicYear = '2026-27',
      course,
      degree,
      level,
      studyYear,
      year,
      batch = '2024–2027',
      search,
      studentIds,
      onlyDefaulters = 'true'
    } = req.query;

    const { dataRows, sortedCategories, rawStudentCount } = await fetchPendingFeeExportData({
      academicYear,
      course,
      degree,
      level,
      studyYear,
      year,
      batch,
      search,
      studentIds,
      onlyDefaulters
    });

    const count = dataRows.length;
    const totalAssessed = dataRows.reduce((sum, r) => sum + (r.totalAssessed || 0), 0);
    const totalPaid = dataRows.reduce((sum, r) => sum + (r.totalPaid || 0), 0);
    const totalPending = dataRows.reduce((sum, r) => sum + (r.remainingBalance || 0), 0);
    const totalConcession = dataRows.reduce((sum, r) => sum + (r.concession || 0), 0);

    const sampleStudents = dataRows.slice(0, 8).map(r => ({
      rollNumber: r.rollNumber,
      name: r.name,
      course: r.course,
      studyYear: r.studyYear,
      academicYear: r.academicYear,
      batch: r.batch,
      totalAssessed: r.totalAssessed,
      totalPaid: r.totalPaid,
      remainingBalance: r.remainingBalance
    }));

    res.json({
      success: true,
      data: {
        count,
        rawStudentCount,
        totalAssessed,
        totalPaid,
        totalPending,
        totalConcession,
        sampleStudents,
        categories: sortedCategories,
        filters: {
          academicYear,
          batch,
          course: course || 'All',
          studyYear: studyYear || year || 'All'
        }
      }
    });
  } catch (error) {
    console.error('Pending fee preview error:', error);
    res.status(500).json({ success: false, message: 'Failed to calculate export preview' });
  }
};

/**
 * @desc    Export Detailed Pending Fee Data Workbook
 * @route   GET /api/exports/pending-fees
 * @access  Private (Admin & Accountant)
 */
exports.exportPendingFeesExcel = async (req, res) => {
  try {
    const {
      academicYear,
      course,
      degree,
      level,
      studyYear,
      year,
      batch,
      search,
      studentIds,
      onlyDefaulters = 'true'
    } = req.query;

    const { dataRows, sortedCategories } = await fetchPendingFeeExportData({
      academicYear,
      course,
      degree,
      level,
      studyYear,
      year,
      batch,
      search,
      studentIds,
      onlyDefaulters
    });

    // Determine if any concessions exist across the exported records
    const hasAnyConcession = dataRows.some(r => (r.concession || 0) > 0);

    // 4. Create Excel Workbook with ExcelJS
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sri Sai Degree & PG College';
    workbook.lastModifiedBy = req.user?.name || 'Accounts Office';
    workbook.created = new Date();

    const sheetName = 'Pending_Fees_Register';
    const worksheet = workbook.addWorksheet(sheetName, {
      views: [
        {
          state: 'frozen',
          xSplit: 2, // Freeze Roll Number and Student Name
          ySplit: 5  // Freeze Title and Header rows 1-5
        }
      ],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
      }
    });

    // Color Palette Constants
    const COLORS = {
      headerPrimary: 'FF0F172A',   // Slate 900
      studentHeader: 'FF1E3A8A',   // Blue 900
      categoryHeader: 'FF0E7490',  // Cyan 700 / Teal
      summaryHeader: 'FF1E1B4B',   // Indigo 950
      columnHeader: 'FF334155',    // Slate 700
      zebraEven: 'FFF8FAFC',       // Slate 50
      zebraOdd: 'FFFFFFFF',        // White
      totalsBg: 'FFFEF3C7',        // Amber 100
      borderColor: 'FFCBD5E1'      // Slate 300
    };

    const borderStyle = {
      top: { style: 'thin', color: { argb: COLORS.borderColor } },
      left: { style: 'thin', color: { argb: COLORS.borderColor } },
      bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
      right: { style: 'thin', color: { argb: COLORS.borderColor } }
    };

    // Calculate Column Layout
    // Student Info: 7 columns (Cols 1-7)
    // Categories: sortedCategories.length (exactly 1 col per category)
    // Summary: hasAnyConcession ? 4 cols (Total Assessed, Concession, Total Paid, Remaining Balance) : 3 cols
    const numStudentCols = 7;
    const numCategoryCols = sortedCategories.length;
    const numSummaryCols = hasAnyConcession ? 4 : 3;
    const totalCols = numStudentCols + numCategoryCols + numSummaryCols;

    // --- ROW 1: COLLEGE BANNER ---
    worksheet.mergeCells(1, 1, 1, totalCols);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = 'SRI SAI DEGREE & PG COLLEGE — PENDING FEE REGISTER';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerPrimary } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 30;

    // --- ROW 2: REPORT SUBTITLE & METADATA ---
    worksheet.mergeCells(2, 1, 2, totalCols);
    const subCell = worksheet.getCell(2, 1);
    const filterDesc = [
      `Academic Session: ${academicYear || 'All Sessions'}`,
      course && course !== 'All' ? `Course: ${course}` : null,
      degree && degree !== 'All' ? `Degree: ${degree}` : null,
      level && level !== 'All' ? `Level: ${level}` : null,
      studyYear && studyYear !== 'All' ? `Year: ${studyYear}` : null,
      `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      `Total Records: ${dataRows.length}`
    ].filter(Boolean).join('  |  ');

    subCell.value = filterDesc;
    subCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF475569' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(2).height = 20;

    // --- ROW 3: BLANK SEPARATOR ---
    worksheet.getRow(3).height = 6;

    // --- ROW 4: GROUP HEADERS (Row 1 of table header) ---
    // 1. Student Info Group (Cols 1 to 7)
    worksheet.mergeCells(4, 1, 4, numStudentCols);
    const stuGroup = worksheet.getCell(4, 1);
    stuGroup.value = 'STUDENT INFORMATION';
    stuGroup.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    stuGroup.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.studentHeader } };
    stuGroup.alignment = { vertical: 'middle', horizontal: 'center' };

    // 2. Fee Categories Group (Cols 8 to 7 + numCategoryCols)
    const catStartCol = 8;
    const catEndCol = 7 + numCategoryCols;
    worksheet.mergeCells(4, catStartCol, 4, catEndCol);
    const catGroup = worksheet.getCell(4, catStartCol);
    catGroup.value = 'ORIGINAL ASSESSED FEE STRUCTURE (BY CATEGORY)';
    catGroup.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    catGroup.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.categoryHeader } };
    catGroup.alignment = { vertical: 'middle', horizontal: 'center' };

    // 3. Overall Summary Group (Remaining cols)
    const sumStartCol = catEndCol + 1;
    worksheet.mergeCells(4, sumStartCol, 4, totalCols);
    const sumGroup = worksheet.getCell(4, sumStartCol);
    sumGroup.value = 'OVERALL FINANCIAL SUMMARY';
    sumGroup.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    sumGroup.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.summaryHeader } };
    sumGroup.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(4).height = 24;

    // Apply borders across all Row 4 cells
    for (let c = 1; c <= totalCols; c++) {
      const cell = worksheet.getCell(4, c);
      cell.border = borderStyle;
    }

    // --- ROW 5: INDIVIDUAL COLUMN HEADERS (Row 2 of table header) ---
    const row5Values = [
      'Roll Number',
      'Student Name',
      'Level',
      'Degree',
      'Course / Specialization',
      'Year of Study',
      'Academic Year'
    ];

    // Exactly one column per category
    sortedCategories.forEach((cat) => {
      row5Values.push(cat);
    });

    row5Values.push('Total Assessed Fee');
    if (hasAnyConcession) {
      row5Values.push('Concession');
    }
    row5Values.push('Total Paid', 'Remaining Balance');

    const row5 = worksheet.getRow(5);
    row5.values = row5Values;
    row5.height = 22;

    row5.eachCell((cell, colNum) => {
      cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.columnHeader } };
      cell.alignment = { vertical: 'middle', horizontal: colNum <= 7 ? 'center' : 'right' };
      cell.border = borderStyle;
    });

    // Auto-filter on Row 5 across all columns
    worksheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5, column: totalCols }
    };

    // --- ROWS 6+: DATA ROWS ---
    const inrFormat = '[$₹-en-IN] #,##0';
    let dataRowIndex = 6;

    if (dataRows.length === 0) {
      const emptyRow = worksheet.getRow(6);
      emptyRow.height = 28;
      worksheet.mergeCells(6, 1, 6, totalCols);
      const cell = worksheet.getCell(6, 1);
      cell.value = 'No students match the specified filter criteria.';
      cell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF64748B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraEven } };
      cell.border = borderStyle;
      dataRowIndex = 7;
    } else {
      dataRows.forEach((item, rIdx) => {
        const rowValues = [
          sanitizeCell(item.rollNumber),
          sanitizeCell(item.name),
          sanitizeCell(item.level),
          sanitizeCell(item.degree),
          sanitizeCell(item.course),
          sanitizeCell(item.studyYear),
          sanitizeCell(item.academicYear)
        ];

        // Original assessed fee for each category (exactly one col per category)
        sortedCategories.forEach((cat) => {
          rowValues.push(item.categories[cat] || 0);
        });

        rowValues.push(item.totalAssessed);
        if (hasAnyConcession) {
          rowValues.push(item.concession);
        }
        rowValues.push(item.totalPaid, item.remainingBalance);

        const dRow = worksheet.getRow(dataRowIndex);
        dRow.values = rowValues;
        dRow.height = 20;

        const isEven = rIdx % 2 === 0;
        const rowBg = isEven ? COLORS.zebraOdd : COLORS.zebraEven;

        dRow.eachCell((cell, colNum) => {
          cell.font = { name: 'Calibri', size: 9.5, color: { argb: 'FF1E293B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          cell.border = borderStyle;

          if (colNum <= 7) {
            cell.alignment = {
              vertical: 'middle',
              horizontal: (colNum === 1 || colNum === 2 || colNum === 5) ? 'left' : 'center'
            };
            if (colNum === 1 || colNum === 2) {
              cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
            }
          } else {
            // Financial column: INR currency formatting
            cell.numFmt = inrFormat;
            cell.alignment = { vertical: 'middle', horizontal: 'right' };

            // Highlight remaining balance column
            if (colNum === totalCols && cell.value > 0) {
              cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFDC2626' } }; // Red
            } else if (colNum === (totalCols - 1) && cell.value > 0) {
              cell.font = { name: 'Calibri', size: 9.5, color: { argb: 'FF16A34A' } }; // Green for paid
            }
          }
        });

        dataRowIndex++;
      });
    }

    // --- FINAL TOTALS ROW ---
    const totalsRowIndex = dataRowIndex;
    const totalsRow = worksheet.getRow(totalsRowIndex);

    // Merge columns 1 to 7 for Totals Label
    worksheet.mergeCells(totalsRowIndex, 1, totalsRowIndex, 7);
    const labelCell = worksheet.getCell(totalsRowIndex, 1);
    labelCell.value = `GRAND TOTAL (${dataRows.length} RECORDS)`;
    labelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF78350F' } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'right' };

    // Fill SUM formulas for all financial columns (Cols 8 to totalCols)
    for (let col = 8; col <= totalCols; col++) {
      const colLetter = worksheet.getColumn(col).letter;
      const cell = worksheet.getCell(totalsRowIndex, col);
      if (dataRows.length > 0) {
        cell.value = {
          formula: `SUM(${colLetter}6:${colLetter}${totalsRowIndex - 1})`
        };
      } else {
        cell.value = 0;
      }
      cell.numFmt = inrFormat;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF78350F' } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }

    totalsRow.height = 24;

    const totalsBorderStyle = {
      top: { style: 'thin', color: { argb: 'FFD97706' } },
      bottom: { style: 'double', color: { argb: 'FFB45309' } },
      left: { style: 'thin', color: { argb: COLORS.borderColor } },
      right: { style: 'thin', color: { argb: COLORS.borderColor } }
    };

    for (let c = 1; c <= totalCols; c++) {
      const cell = worksheet.getCell(totalsRowIndex, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalsBg } };
      cell.border = totalsBorderStyle;
    }

    // --- AUTO-FIT COLUMN WIDTHS ---
    const minWidths = {
      1: 16, // Roll Number
      2: 24, // Student Name
      3: 10, // Level
      4: 12, // Degree
      5: 26, // Course
      6: 14, // Year of Study
      7: 15  // Academic Year
    };

    for (let c = 1; c <= totalCols; c++) {
      const col = worksheet.getColumn(c);
      let maxLen = minWidths[c] || 15;

      // Ensure header lengths are respected
      const r5Val = String(worksheet.getCell(5, c).value || '');
      if (r5Val.length + 4 > maxLen) {
        maxLen = r5Val.length + 4;
      }

      col.width = Math.max(maxLen, 14);
    }

    // Set Response Headers for Instant Download
    const safeYear = (academicYear && academicYear !== 'All') ? academicYear.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Years';
    const filename = `Pending_Fee_Report_${safeYear}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export pending fees excel error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate pending fee report' });
  }
};

// Export sanitizer for unit testing and reuse
exports.sanitizeCell = sanitizeCell;

// Legacy exports preserved
exports.exportFullExcel = exports.exportMasterWorkbook;
exports.exportFilteredExcel = exports.exportMasterWorkbook;

function styleWorksheet(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 28;

  // Format number cells
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'middle' };
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0';
        }
      });
    }
  });
}

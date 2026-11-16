const AuditLog = require('../models/AuditLog');

/**
 * Create an audit log entry.
 */
async function createAuditLog({
  user,
  userName,
  userRole,
  action,
  entity,
  entityId,
  description,
  oldValue,
  newValue,
  reason,
  ipAddress
}) {
  try {
    await AuditLog.create({
      timestamp: new Date(),
      user,
      userName: userName || 'System',
      userRole: userRole || 'system',
      action,
      entity,
      entityId,
      description,
      oldValue,
      newValue,
      reason,
      ipAddress
    });
  } catch (error) {
    console.error('Audit log creation failed:', error.message);
  }
}

/**
 * Generate a unique sequential ID.
 */
async function generateId(Model, prefix, field = 'studentId') {
  const items = await Model.find({
    [field]: new RegExp(`^${prefix}`)
  }).select(field);

  let maxNum = 0;
  for (const item of items) {
    if (item[field]) {
      const num = parseInt(item[field].split('-').pop(), 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let candidateNum = maxNum + 1;
  let id = `${prefix}-${candidateNum.toString().padStart(4, '0')}`;
  while (await Model.exists({ [field]: id })) {
    candidateNum++;
    id = `${prefix}-${candidateNum.toString().padStart(4, '0')}`;
  }
  return id;
}

/**
 * Get standard course code for student receipt generation
 */
function getCourseCode(courseName = '', degree = '', specialization = '') {
  const combined = `${courseName} ${degree} ${specialization}`.toLowerCase();
  if (combined.includes('zoology')) return 'ZOO';
  if (combined.includes('organic')) return 'ORG';
  if (combined.includes('chemistry')) return 'CHE';
  if (combined.includes('computer science') || combined.includes('comp sci')) return 'CSC';
  if (combined.includes('computer app') || combined.includes('computer application')) return 'CCA';
  if (combined.includes('bca')) return 'BCA';
  if (combined.includes('mca')) return 'MCA';
  if (combined.includes('mba')) return 'MBA';
  if (combined.includes('commerce') || combined.includes('b.com')) return 'COM';
  
  const clean = (specialization || degree || courseName || 'GEN').replace(/[^a-zA-Z]/g, '').toUpperCase();
  return clean.substring(0, 3).padEnd(3, 'X');
}

/**
 * Generate a student-based structured receipt number: YYCCCNNN-PPP
 * Format:
 * - YY: Admission year (last 2 digits)
 * - CCC: Course short code (e.g., CSC, CCA, ZOO, CHE, ORG)
 * - NNN: Student roll number padded to 3 digits
 * - PPP: Payment sequence for this student padded to 3 digits (001, 002, ...)
 */
async function generateStudentReceiptNo(studentDocOrId) {
  const Payment = require('../models/Payment');
  const Student = require('../models/Student');
  const Course = require('../models/Course');

  let student = studentDocOrId;
  if (!student || !student._id || typeof studentDocOrId === 'string') {
    student = await Student.findOne({
      $or: [
        { studentId: String(studentDocOrId) },
        ...(typeof studentDocOrId === 'string' && studentDocOrId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: studentDocOrId }] : [])
      ]
    }).lean();
  }

  if (!student) {
    // Fallback to legacy generator if student record cannot be located
    return await generateReceiptNo();
  }

  // 1. Admission Year YY (last 2 digits)
  let admissionYear = student.admissionYear || student.batchStartYear;
  if (!admissionYear && student.batch) {
    const match = String(student.batch).match(/\b(20\d{2})\b/);
    if (match) admissionYear = parseInt(match[1], 10);
  }
  if (!admissionYear && student.admissionNo) {
    const match = String(student.admissionNo).match(/\b(20\d{2})\b/);
    if (match) admissionYear = parseInt(match[1], 10);
  }
  if (!admissionYear && student.currentAcademicYear) {
    const match = String(student.currentAcademicYear).match(/\b(20\d{2})\b/);
    if (match) admissionYear = parseInt(match[1], 10);
  }
  const yy = String(admissionYear || new Date().getFullYear()).slice(-2);

  // 2. Course Code CCC
  let ccc = null;
  if (student.courseId) {
    const courseObj = await Course.findById(student.courseId).lean();
    if (courseObj?.receiptCourseCode) ccc = courseObj.receiptCourseCode;
  }
  if (!ccc) {
    ccc = getCourseCode(student.course, student.degree, student.specialization);
  }

  // 3. Roll Number NNN (padded to 3 digits)
  let nnn = '001';
  if (student.rollNo) {
    const rollDigits = String(student.rollNo).replace(/\D/g, '');
    if (rollDigits) {
      nnn = parseInt(rollDigits, 10).toString().padStart(3, '0');
    } else {
      nnn = String(student.rollNo).slice(-3).padStart(3, '0');
    }
  } else if (student.admissionNo) {
    const admDigits = String(student.admissionNo).replace(/\D/g, '');
    if (admDigits) {
      nnn = parseInt(admDigits.slice(-3), 10).toString().padStart(3, '0');
    }
  } else if (student.studentId) {
    const idDigits = String(student.studentId).replace(/\D/g, '');
    if (idDigits) {
      nnn = parseInt(idDigits.slice(-3), 10).toString().padStart(3, '0');
    }
  }

  const prefix = `${yy}${ccc}${nnn}`;

  // 4. Payment sequence PPP for this student
  // Find all previous payments (completed and cancelled) for this student
  const studentPayments = await Payment.find({
    student: student._id
  }).select('receiptNo').lean();

  // Strict regex matching ONLY this student's prefix: ^YYCCCNNN-(\d+)$
  // Legacy receipts like REC-2026-800021 must NEVER inflate this student-specific sequence.
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefixRegex = new RegExp(`^${escapedPrefix}-(\\d+)$`, 'i');

  let maxSeq = 0;
  for (const p of studentPayments) {
    if (p.receiptNo) {
      const match = p.receiptNo.match(prefixRegex);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  }

  // Next sequence starts at 001 if no receipts exist under this format, otherwise maxSeq + 1
  let candidateSeq = maxSeq + 1;
  let receiptNo = `${prefix}-${candidateSeq.toString().padStart(3, '0')}`;

  // Ensure absolute uniqueness across database (concurrency safe)
  while (await Payment.exists({ receiptNo })) {
    candidateSeq++;
    receiptNo = `${prefix}-${candidateSeq.toString().padStart(3, '0')}`;
  }

  return receiptNo;
}

/**
 * Generate a unique receipt number: REC-YYYY-NNNNN (legacy format kept for backward compatibility)
 */
async function generateReceiptNo() {
  const Payment = require('../models/Payment');
  const year = new Date().getFullYear();
  const prefix = `REC-${year}`;

  const payments = await Payment.find({
    receiptNo: new RegExp(`^${prefix}`)
  }).select('receiptNo');

  let maxNum = 0;
  for (const p of payments) {
    if (p.receiptNo) {
      const parts = p.receiptNo.split('-');
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let candidateNum = maxNum + 1;
  let receiptNo = `${prefix}-${candidateNum.toString().padStart(5, '0')}`;

  while (await Payment.exists({ receiptNo })) {
    candidateNum++;
    receiptNo = `${prefix}-${candidateNum.toString().padStart(5, '0')}`;
  }

  return receiptNo;
}

/**
 * Format currency in Indian format.
 */
function formatIndianCurrency(amount) {
  if (amount === undefined || amount === null) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

/**
 * Formula injection sanitizer (prevents Excel execution of =, +, -, @, \t, \r)
 */
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

module.exports = {
  createAuditLog,
  generateId,
  generateReceiptNo,
  generateStudentReceiptNo,
  getCourseCode,
  formatIndianCurrency,
  sanitizeCell
};

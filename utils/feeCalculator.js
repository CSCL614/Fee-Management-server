const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const Student = require('../models/Student');

/**
 * Pure calculation logic for a single student given their pre-fetched demands and payments.
 * Zero database queries executed inside this function (runs in < 0.05ms in CPU memory).
 */
function computeStudentSummary(student, demands = [], payments = [], targetAcademicYear = null, now = new Date()) {
  const sortedDemands = [...demands].sort((a, b) => (a.academicYear || '').localeCompare(b.academicYear || ''));
  const sortedPayments = [...payments].sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

  const yearSummaries = [];
  let cumulativeCarryForward = 0;

  for (const demand of sortedDemands) {
    const yearPayments = sortedPayments.filter(p => p.academicYear === demand.academicYear);
    const totalPaidForYear = yearPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);

    const activeCategories = (demand.categories || []).filter(c => !c.activationDate || new Date(c.activationDate) <= now);
    const upcomingCategories = (demand.categories || []).filter(c => c.activationDate && new Date(c.activationDate) > now);

    const activeDemandTotal = activeCategories.reduce((sum, c) => sum + (c.amount || 0), 0);
    const upcomingDemandTotal = upcomingCategories.reduce((sum, c) => sum + (c.amount || 0), 0);

    const currentYearFee = activeDemandTotal;
    const previousYearDue = cumulativeCarryForward;
    const totalPayable = currentYearFee + previousYearDue;
    const totalPaid = totalPaidForYear;
    const pending = Math.max(0, totalPayable - totalPaid);
    const advanceCredit = totalPaid > totalPayable ? totalPaid - totalPayable : 0;

    let status = 'Due';
    if (pending === 0) status = 'Paid';
    else if (totalPaid > 0) status = 'Partial';

    const summary = {
      academicYear: demand.academicYear,
      year: demand.year,
      course: demand.course,
      level: demand.level,
      currentYearFee,
      upcomingFeeTotal: upcomingDemandTotal,
      previousYearDue,
      totalPayable,
      totalPaid,
      pending,
      advanceCredit,
      status,
      categories: demand.categories,
      activeCategories,
      upcomingCategories,
      payments: yearPayments.map(p => ({
        receiptNo: p.receiptNo,
        amountPaid: p.amountPaid,
        paymentDate: p.paymentDate,
        paymentMode: p.paymentMode,
        transactionId: p.transactionId,
        status: p.status
      }))
    };

    yearSummaries.push(summary);
    cumulativeCarryForward = pending;
  }

  const currentYearSummary = targetAcademicYear
    ? yearSummaries.find(s => s.academicYear === targetAcademicYear)
    : yearSummaries[yearSummaries.length - 1];

  const totalFeeAllYears = yearSummaries.reduce((sum, d) => sum + d.currentYearFee, 0);
  const totalPaidAllYears = sortedPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
  const totalPendingAllYears = Math.max(0, totalFeeAllYears - totalPaidAllYears);
  const totalAdvanceCredit = totalPaidAllYears > totalFeeAllYears ? totalPaidAllYears - totalFeeAllYears : 0;

  let overallStatus = 'Due';
  if (totalPendingAllYears === 0) overallStatus = 'Paid';
  else if (totalPaidAllYears > 0) overallStatus = 'Partial';

  return {
    student: {
      _id: student._id,
      studentId: student.studentId,
      admissionNo: student.admissionNo,
      name: student.name,
      course: student.course,
      level: student.level,
      batch: student.batch,
      batchStartYear: student.batchStartYear,
      batchEndYear: student.batchEndYear,
      currentYear: student.currentYear,
      currentAcademicYear: student.currentAcademicYear,
      status: student.status,
      advanceCredit: student.advanceCredit
    },
    yearSummaries,
    currentYearSummary: currentYearSummary || null,
    overall: {
      totalFee: totalFeeAllYears,
      totalPaid: totalPaidAllYears,
      totalPending: totalPendingAllYears,
      advanceCredit: totalAdvanceCredit,
      status: overallStatus
    }
  };
}

/**
 * High-performance batch fee calculation for multiple students.
 * Replaces N*3 sequential database queries with exactly 2 batched queries.
 * @param {Array<Object>} students Array of student documents/objects
 * @param {string|null} targetAcademicYear Optional academic year filter
 * @returns {Promise<Map<string, Object>>} Map of studentId/_id -> Fee Summary
 */
async function calculateBatchFeeSummaries(students, targetAcademicYear = null) {
  if (!students || students.length === 0) return new Map();

  const studentObjectIds = students.map(s => s._id);
  const now = new Date();

  // Execute both queries concurrently with .lean() for minimal overhead
  const [allDemands, allPayments] = await Promise.all([
    FeeDemand.find({
      student: { $in: studentObjectIds },
      status: 'active'
    }).sort({ academicYear: 1 }).lean(),
    Payment.find({
      student: { $in: studentObjectIds },
      status: 'completed'
    }).sort({ paymentDate: 1 }).lean()
  ]);

  // Group demands and payments in-memory by student ObjectId string
  const demandsByStudent = new Map();
  const paymentsByStudent = new Map();

  for (const d of allDemands) {
    const key = d.student.toString();
    if (!demandsByStudent.has(key)) demandsByStudent.set(key, []);
    demandsByStudent.get(key).push(d);
  }

  for (const p of allPayments) {
    const key = p.student.toString();
    if (!paymentsByStudent.has(key)) paymentsByStudent.set(key, []);
    paymentsByStudent.get(key).push(p);
  }

  const results = new Map();
  for (const student of students) {
    const sId = student._id.toString();
    const sDemands = demandsByStudent.get(sId) || [];
    const sPayments = paymentsByStudent.get(sId) || [];

    const summary = computeStudentSummary(student, sDemands, sPayments, targetAcademicYear, now);
    results.set(sId, summary);
    if (student.studentId) {
      results.set(student.studentId, summary);
    }
  }

  return results;
}

/**
 * Calculate complete fee summary for a single student, across ALL academic years.
 * Uses .lean() and concurrent queries to minimize latency.
 */
async function calculateFeeSummary(studentId, targetAcademicYear = null) {
  const student = await Student.findOne({
    $or: [
      { studentId },
      { _id: typeof studentId === 'string' && studentId.match(/^[0-9a-fA-F]{24}$/) ? studentId : undefined }
    ].filter(Boolean)
  }).lean();

  if (!student) throw new Error('Student not found');

  // Concurrently fetch active demands and completed payments
  const [allDemands, allPayments] = await Promise.all([
    FeeDemand.find({
      student: student._id,
      status: 'active'
    }).sort({ academicYear: 1 }).lean(),
    Payment.find({
      student: student._id,
      status: 'completed'
    }).sort({ paymentDate: 1 }).lean()
  ]);

  return computeStudentSummary(student, allDemands, allPayments, targetAcademicYear);
}

/**
 * Generate fee ledger entries for a student.
 * Uses parallel queries and .lean() for low-latency response.
 */
async function generateFeeLedger(studentId) {
  const student = await Student.findOne({
    $or: [
      { studentId },
      { _id: typeof studentId === 'string' && studentId.match(/^[0-9a-fA-F]{24}$/) ? studentId : undefined }
    ].filter(Boolean)
  }).lean();

  if (!student) throw new Error('Student not found');

  // Concurrently fetch active demands, completed payments, and cancelled payments
  const [demands, payments, cancelledPayments] = await Promise.all([
    FeeDemand.find({
      student: student._id,
      status: 'active'
    }).sort({ createdAt: 1 }).lean(),
    Payment.find({
      student: student._id,
      status: 'completed'
    }).sort({ paymentDate: 1, createdAt: 1 }).lean(),
    Payment.find({
      student: student._id,
      status: 'cancelled'
    }).sort({ cancelledAt: 1 }).lean()
  ]);

  // Merge into a single chronological ledger
  const entries = [];

  // Add demand entries (debits)
  for (const demand of demands) {
    entries.push({
      date: demand.createdAt,
      type: 'demand',
      description: `Fee Demand - ${demand.year} (${demand.academicYear})`,
      debit: demand.totalDemand,
      credit: 0,
      academicYear: demand.academicYear,
      year: demand.year,
      referenceId: demand._id
    });
  }

  // Add payment entries (credits)
  for (const payment of payments) {
    entries.push({
      date: payment.paymentDate,
      type: 'payment',
      description: `Payment - ${payment.paymentMode} (${payment.receiptNo})`,
      debit: 0,
      credit: payment.amountPaid,
      academicYear: payment.academicYear,
      year: payment.year,
      referenceId: payment.receiptNo
    });
  }

  // Add cancelled payment entries for transparency
  for (const payment of cancelledPayments) {
    entries.push({
      date: payment.paymentDate,
      type: 'payment',
      description: `Payment - ${payment.paymentMode} (${payment.receiptNo})`,
      debit: 0,
      credit: payment.amountPaid,
      academicYear: payment.academicYear,
      year: payment.year,
      referenceId: payment.receiptNo
    });
    entries.push({
      date: payment.cancelledAt || payment.updatedAt,
      type: 'cancellation',
      description: `Payment Cancelled (${payment.receiptNo}) - ${payment.cancelReason || 'No reason'}`,
      debit: payment.amountPaid,
      credit: 0,
      academicYear: payment.academicYear,
      year: payment.year,
      referenceId: payment.receiptNo
    });
  }

  // Sort chronologically
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate running balance
  let runningBalance = 0;
  for (const entry of entries) {
    runningBalance += entry.debit - entry.credit;
    entry.balance = runningBalance;
  }

  return {
    student: {
      studentId: student.studentId,
      name: student.name,
      admissionNo: student.admissionNo,
      course: student.course,
      level: student.level
    },
    entries,
    closingBalance: runningBalance
  };
}

/**
 * Validate a payment amount.
 * If advance payments are not allowed, amount cannot exceed remaining payable.
 * Returns { valid, maxAllowed, remaining, advanceAmount }
 */
async function validatePaymentAmount(studentId, academicYear, amount, allowAdvance = false) {
  const summary = await calculateFeeSummary(studentId, academicYear);

  if (!summary.currentYearSummary) {
    return {
      valid: false,
      message: 'No fee demand found for this academic year',
      maxAllowed: 0,
      remaining: 0
    };
  }

  const remaining = summary.currentYearSummary.pending;

  if (amount <= 0) {
    return {
      valid: false,
      message: 'Payment amount must be greater than zero',
      maxAllowed: remaining,
      remaining
    };
  }

  if (!allowAdvance && amount > remaining) {
    return {
      valid: false,
      message: `Payment amount (₹${amount}) exceeds remaining due (₹${remaining}). Advance payments are not enabled.`,
      maxAllowed: remaining,
      remaining
    };
  }

  const advanceAmount = amount > remaining ? amount - remaining : 0;

  return {
    valid: true,
    maxAllowed: allowAdvance ? Infinity : remaining,
    remaining,
    advanceAmount
  };
}

module.exports = {
  calculateFeeSummary,
  calculateBatchFeeSummaries,
  computeStudentSummary,
  generateFeeLedger,
  validatePaymentAmount
};

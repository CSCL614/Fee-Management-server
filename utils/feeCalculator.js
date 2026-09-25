const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const Student = require('../models/Student');

/**
 * Calculate complete fee summary for a student, across ALL academic years.
 * Previous year dues are computed dynamically from fee demands vs payments.
 * Pending never goes negative — excess becomes advance credit.
 */
async function calculateFeeSummary(studentId, targetAcademicYear = null) {
  const student = await Student.findOne({ studentId });
  if (!student) throw new Error('Student not found');

  // Get ALL fee demands for this student, sorted chronologically
  const allDemands = await FeeDemand.find({
    student: student._id,
    status: 'active'
  }).sort({ academicYear: 1 });

  // Get ALL completed payments for this student
  const allPayments = await Payment.find({
    student: student._id,
    status: 'completed'
  }).sort({ paymentDate: 1 });

  // Build year-by-year summary
  const yearSummaries = [];
  let cumulativeCarryForward = 0;

  for (const demand of allDemands) {
    const yearPayments = allPayments.filter(p => p.academicYear === demand.academicYear);
    const totalPaidForYear = yearPayments.reduce((sum, p) => sum + p.amountPaid, 0);

    const currentYearFee = demand.totalDemand;
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
      previousYearDue,
      totalPayable,
      totalPaid,
      pending,
      advanceCredit,
      status,
      categories: demand.categories,
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

    // Carry forward: unpaid amount (not advance) carries to next year
    cumulativeCarryForward = pending;
  }

  // If a specific academic year is requested, return just that year's data
  // but still include the carry-forward from all prior years
  const currentYearSummary = targetAcademicYear
    ? yearSummaries.find(s => s.academicYear === targetAcademicYear)
    : yearSummaries[yearSummaries.length - 1];

  // Overall totals
  const totalFeeAllYears = allDemands.reduce((sum, d) => sum + d.totalDemand, 0);
  const totalPaidAllYears = allPayments.reduce((sum, p) => sum + p.amountPaid, 0);
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
 * Generate fee ledger entries for a student.
 * Shows Date, Description, Debit (fee demand), Credit (payment), Running Balance.
 */
async function generateFeeLedger(studentId) {
  const student = await Student.findOne({ studentId });
  if (!student) throw new Error('Student not found');

  // Get all demands and payments
  const demands = await FeeDemand.find({
    student: student._id,
    status: 'active'
  }).sort({ createdAt: 1 });

  const payments = await Payment.find({
    student: student._id,
    status: 'completed'
  }).sort({ paymentDate: 1, createdAt: 1 });

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
  const cancelledPayments = await Payment.find({
    student: student._id,
    status: 'cancelled'
  }).sort({ cancelledAt: 1 });

  for (const payment of cancelledPayments) {
    // Original payment (credit)
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
    // Cancellation (debit reversal)
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
  generateFeeLedger,
  validatePaymentAmount
};

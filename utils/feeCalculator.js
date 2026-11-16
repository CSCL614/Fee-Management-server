const mongoose = require('mongoose');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const Student = require('../models/Student');

/**
 * Pure calculation logic for a single student given their pre-fetched demands and payments.
 * Zero database queries executed inside this function (runs in < 0.05ms in CPU memory).
 */
function computeStudentSummary(student, demands = [], payments = [], targetAcademicYear = null, now = new Date()) {
  const sortedDemands = [...demands].sort((a, b) => (a.academicYear || '').localeCompare(b.academicYear || ''));
  // Strictly filter only completed payments for all financial accounting calculations (exclude cancelled, pending, refunded)
  const validPayments = (payments || []).filter(p => !p.status || p.status === 'completed');
  const sortedPayments = [...validPayments].sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

  const yearSummaries = [];
  let cumulativeCarryForward = 0;

  for (const demand of sortedDemands) {
    const yearPayments = sortedPayments.filter(p => p.academicYear === demand.academicYear);
    const totalPaidForYear = yearPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);

    const activeCategoriesRaw = (demand.categories || []).filter(c => !c.activationDate || new Date(c.activationDate) <= now);
    const upcomingCategoriesRaw = (demand.categories || []).filter(c => c.activationDate && new Date(c.activationDate) > now);

    const activeDemandTotal = activeCategoriesRaw.reduce((sum, c) => sum + (c.amount || 0), 0);
    const upcomingDemandTotal = upcomingCategoriesRaw.reduce((sum, c) => sum + (c.amount || 0), 0);

    const currentYearFee = activeDemandTotal;
    // Decoupled Academic Years: Previous year dues are preserved in their respective academic year
    // and are never added to current year's assessed fee demand or payable balance.
    const previousYearDue = 0;
    const totalPayable = currentYearFee;
    const totalPaid = totalPaidForYear;
    const pending = Math.max(0, currentYearFee - totalPaid);
    const advanceCredit = totalPaid > currentYearFee ? totalPaid - currentYearFee : 0;

    let status = 'Due';
    if (pending === 0) status = 'Paid';
    else if (totalPaid > 0) status = 'Partial';

    // Compute category-wise payment breakdown
    const categoryPaidMap = new Map();
    let unallocatedPaymentTotal = 0;

    for (const payment of yearPayments) {
      if (payment.allocations && payment.allocations.length > 0) {
        for (const alloc of payment.allocations) {
          const key = `${(alloc.category || '').toLowerCase()}|${alloc.semester || ''}`;
          categoryPaidMap.set(key, (categoryPaidMap.get(key) || 0) + (alloc.amount || 0));
        }
      } else {
        // If historical payment without allocation array, track unallocated
        unallocatedPaymentTotal += (payment.amountPaid || 0);
      }
    }

    // Process categories with paid & remaining
    const categoryBalances = (demand.categories || []).map(c => {
      const isUpcoming = Boolean(c.activationDate && new Date(c.activationDate) > now);
      const key = `${(c.category || '').toLowerCase()}|${c.semester || ''}`;
      let paid = categoryPaidMap.get(key) || 0;

      // If there are unallocated historical payments, attribute to Tuition Fee
      if (unallocatedPaymentTotal > 0 && c.category.toLowerCase().includes('tuition')) {
        const needed = Math.max(0, c.amount - paid);
        const applyAmt = Math.min(needed, unallocatedPaymentTotal);
        paid += applyAmt;
        unallocatedPaymentTotal -= applyAmt;
      }

      const catPending = Math.max(0, (c.amount || 0) - paid);
      let catStatus = 'Due';
      if (catPending === 0) catStatus = 'Paid';
      else if (paid > 0) catStatus = 'Partial';
      if (isUpcoming && paid === 0) catStatus = 'upcoming';

      const isTuition = (c.category || '').toLowerCase().includes('tuition');
      const catConcession = isTuition ? (c.concession || demand.concession?.amount || 0) : (c.concession || 0);
      const originalAmount = c.originalAmount != null ? c.originalAmount : (catConcession > 0 ? c.amount + catConcession : c.amount);

      return {
        _id: c._id,
        category: c.category,
        amount: c.amount,
        originalAmount,
        concession: catConcession,
        frequency: c.frequency || 'ANNUAL',
        semester: c.semester || null,
        activationDate: c.activationDate || null,
        dueDate: c.dueDate || null,
        paidAmount: paid,
        remainingAmount: catPending,
        status: catStatus,
        isUpcoming
      };
    });

    const activeCategories = categoryBalances.filter(c => !c.isUpcoming);
    const upcomingCategories = categoryBalances.filter(c => c.isUpcoming);

    const summary = {
      academicYear: demand.academicYear,
      year: demand.year,
      course: demand.course,
      level: demand.level,
      concession: demand.concession || { amount: 0, originalTuitionFee: 0 },
      currentYearFee,
      assessedFee: currentYearFee,
      upcomingFeeTotal: upcomingDemandTotal,
      previousYearDue,
      totalPayable,
      totalPaid,
      paid: totalPaid,
      pending,
      advanceCredit,
      status,
      categories: categoryBalances,
      activeCategories,
      upcomingCategories,
      payments: (payments || []).filter(p => p.academicYear === demand.academicYear).map(p => ({
        receiptNo: p.receiptNo,
        amountPaid: p.amountPaid,
        paymentDate: p.paymentDate,
        paymentMode: p.paymentMode,
        transactionId: p.transactionId,
        feeCategory: p.feeCategory,
        semester: p.semester,
        allocations: p.allocations || [],
        status: p.status
      }))
    };

    yearSummaries.push(summary);
    cumulativeCarryForward = pending;
  }

  const currentYearSummary = targetAcademicYear
    ? yearSummaries.find(s => s.academicYear === targetAcademicYear)
    : yearSummaries[yearSummaries.length - 1];

  const totalFeeAllYears = yearSummaries.reduce((sum, d) => sum + (d.currentYearFee || 0), 0);
  const totalPaidAllYears = sortedPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
  const totalPendingAllYears = yearSummaries.reduce((sum, d) => sum + (d.pending || 0), 0);
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
async function generateFeeLedger(studentId, filters = {}) {
  const isObjectId = mongoose.isValidObjectId(studentId);
  const student = await Student.findOne({
    $or: [
      { studentId: String(studentId) },
      ...(isObjectId ? [{ _id: studentId }] : [])
    ]
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
    }).sort({ cancelledAt: 1, createdAt: 1 }).lean()
  ]);

  // Merge into a single chronological ledger
  const entries = [];

  // Add demand entries (debits by category)
  for (const demand of demands) {
    if (demand.categories && demand.categories.length > 0) {
      let concessionAppliedForDemand = false;
      for (let cIdx = 0; cIdx < demand.categories.length; cIdx++) {
        const cat = demand.categories[cIdx];
        const isTuition = (cat.category || '').toLowerCase().includes('tuition');
        if (isTuition && demand.concession && demand.concession.amount > 0 && !concessionAppliedForDemand) {
          const originalAmt = cat.originalAmount != null ? cat.originalAmount : (cat.amount + demand.concession.amount);
          entries.push({
            id: `dem_${demand._id}_${cIdx}_orig`,
            demandId: demand._id,
            date: cat.activationDate || demand.createdAt,
            type: 'demand',
            receiptNo: null,
            transactionId: null,
            category: cat.category,
            feeCategory: cat.category,
            semester: cat.semester || null,
            description: `${cat.category}${cat.semester ? ` (${cat.semester})` : ''} assessed (Original Demand)`,
            paymentMethod: '—',
            paymentMode: '—',
            debit: originalAmt,
            credit: 0,
            academicYear: demand.academicYear,
            year: demand.year,
            referenceId: demand._id,
            status: 'active',
            recordedBy: 'Fee Assessment Rule',
            remarks: 'Original fee demand assessment'
          });
          entries.push({
            id: `dem_${demand._id}_concession`,
            demandId: demand._id,
            date: demand.concession.appliedAt || cat.activationDate || demand.createdAt,
            type: 'concession',
            receiptNo: null,
            transactionId: null,
            category: 'Tuition Fee',
            feeCategory: 'Tuition Fee',
            semester: cat.semester || null,
            description: `Tuition Fee Concession${demand.concession.reason ? ` - ${demand.concession.reason}` : ''} (Adjustment)`,
            paymentMethod: 'Fee Waiver / Concession',
            paymentMode: 'Concession',
            debit: -demand.concession.amount,
            credit: 0,
            academicYear: demand.academicYear,
            year: demand.year,
            referenceId: demand._id,
            status: 'applied',
            recordedBy: demand.concession.appliedByName || 'Administrator',
            remarks: demand.concession.reason || 'Tuition concession adjustment'
          });
          concessionAppliedForDemand = true;
        } else {
          entries.push({
            id: `dem_${demand._id}_${cIdx}`,
            demandId: demand._id,
            date: cat.activationDate || demand.createdAt,
            type: 'demand',
            receiptNo: null,
            transactionId: null,
            category: cat.category,
            feeCategory: cat.category,
            semester: cat.semester || null,
            description: `${cat.category}${cat.semester ? ` (${cat.semester})` : ''} assessed`,
            paymentMethod: '—',
            paymentMode: '—',
            debit: cat.amount,
            credit: 0,
            academicYear: demand.academicYear,
            year: demand.year,
            referenceId: demand._id,
            status: 'active',
            recordedBy: 'Fee Assessment Rule',
            remarks: 'Fee demand assessment'
          });
        }
      }
    } else {
      const origDemand = demand.concession && demand.concession.amount > 0 ? demand.totalDemand + demand.concession.amount : demand.totalDemand;
      entries.push({
        id: `dem_${demand._id}_total`,
        demandId: demand._id,
        date: demand.createdAt,
        type: 'demand',
        receiptNo: null,
        transactionId: null,
        category: 'Fee Assessment',
        feeCategory: 'Fee Assessment',
        semester: null,
        description: `Fee Demand assessed - ${demand.year} (${demand.academicYear})`,
        paymentMethod: '—',
        paymentMode: '—',
        debit: origDemand,
        credit: 0,
        academicYear: demand.academicYear,
        year: demand.year,
        referenceId: demand._id,
        status: 'active',
        recordedBy: 'Fee Assessment Rule',
        remarks: 'Annual fee demand'
      });
      if (demand.concession && demand.concession.amount > 0) {
        entries.push({
          id: `dem_${demand._id}_concession`,
          demandId: demand._id,
          date: demand.concession.appliedAt || demand.createdAt,
          type: 'concession',
          receiptNo: null,
          transactionId: null,
          category: 'Tuition Fee',
          feeCategory: 'Tuition Fee',
          semester: null,
          description: `Tuition Fee Concession${demand.concession.reason ? ` - ${demand.concession.reason}` : ''} (Adjustment)`,
          paymentMethod: 'Fee Waiver / Concession',
          paymentMode: 'Concession',
          debit: -demand.concession.amount,
          credit: 0,
          academicYear: demand.academicYear,
          year: demand.year,
          referenceId: demand._id,
          status: 'applied',
          recordedBy: demand.concession.appliedByName || 'Administrator',
          remarks: demand.concession.reason || 'Tuition concession adjustment'
        });
      }
    }
  }

  // Add payment entries (credits by allocation category - preserves each individual payment transaction)
  for (const payment of payments) {
    if (payment.allocations && payment.allocations.length > 0) {
      for (let aIdx = 0; aIdx < payment.allocations.length; aIdx++) {
        const alloc = payment.allocations[aIdx];
        entries.push({
          id: `pay_${payment._id}_${aIdx}`,
          paymentId: payment._id,
          date: payment.paymentDate,
          type: 'payment',
          receiptNo: payment.receiptNo,
          transactionId: payment.transactionId || payment.receiptNo,
          category: alloc.category,
          feeCategory: alloc.category,
          semester: alloc.semester || payment.semester || null,
          description: `${alloc.category}${alloc.semester ? ` (${alloc.semester})` : ''} payment - ${payment.paymentMode} (${payment.receiptNo})`,
          paymentMethod: payment.paymentMode,
          paymentMode: payment.paymentMode,
          debit: 0,
          credit: alloc.amount,
          academicYear: alloc.academicYear || payment.academicYear,
          year: alloc.year || payment.year,
          referenceId: payment.receiptNo,
          status: 'completed',
          recordedBy: payment.enteredByName || 'Cashier',
          remarks: payment.remarks || '',
          allocations: payment.allocations,
          totalReceiptAmount: payment.amountPaid
        });
      }
    } else {
      entries.push({
        id: `pay_${payment._id}_0`,
        paymentId: payment._id,
        date: payment.paymentDate,
        type: 'payment',
        receiptNo: payment.receiptNo,
        transactionId: payment.transactionId || payment.receiptNo,
        category: payment.feeCategory || 'Tuition Fee',
        feeCategory: payment.feeCategory || 'Tuition Fee',
        semester: payment.semester || null,
        description: `${payment.feeCategory ? `${payment.feeCategory} payment` : 'Payment'} - ${payment.paymentMode} (${payment.receiptNo})`,
        paymentMethod: payment.paymentMode,
        paymentMode: payment.paymentMode,
        debit: 0,
        credit: payment.amountPaid,
        academicYear: payment.academicYear,
        year: payment.year,
        referenceId: payment.receiptNo,
        status: 'completed',
        recordedBy: payment.enteredByName || 'Cashier',
        remarks: payment.remarks || '',
        allocations: [],
        totalReceiptAmount: payment.amountPaid
      });
    }
  }

  // Add cancelled payment entries for transparency (with distinct cancelled status and audit trail)
  for (const payment of cancelledPayments) {
    const catName = payment.feeCategory || (payment.allocations?.[0]?.category) || 'Tuition Fee';
    // 1. Original transaction record marked Cancelled
    entries.push({
      id: `pay_canc_${payment._id}`,
      paymentId: payment._id,
      date: payment.paymentDate,
      type: 'payment',
      receiptNo: payment.receiptNo,
      transactionId: payment.transactionId || payment.receiptNo,
      category: catName,
      feeCategory: catName,
      semester: payment.semester || null,
      description: `${catName} payment - ${payment.paymentMode} (${payment.receiptNo}) [CANCELLED]`,
      paymentMethod: payment.paymentMode,
      paymentMode: payment.paymentMode,
      debit: 0,
      credit: payment.amountPaid,
      academicYear: payment.academicYear,
      year: payment.year,
      referenceId: payment.receiptNo,
      status: 'cancelled',
      recordedBy: payment.enteredByName || 'Cashier',
      remarks: payment.remarks ? `[CANCELLED: ${payment.cancelReason || 'Reversed'}] ${payment.remarks}` : `Payment Cancelled: ${payment.cancelReason || 'Reversed'}`,
      allocations: payment.allocations || [],
      totalReceiptAmount: payment.amountPaid
    });

    // 2. Cancellation reversal debit on cancellation date
    entries.push({
      id: `rev_canc_${payment._id}`,
      paymentId: payment._id,
      date: payment.cancelledAt || payment.updatedAt,
      type: 'cancellation',
      receiptNo: payment.receiptNo,
      transactionId: payment.transactionId || payment.receiptNo,
      category: catName,
      feeCategory: catName,
      semester: payment.semester || null,
      description: `Payment Cancelled / Reversal (${payment.receiptNo}) - ${payment.cancelReason || 'Reversal'}`,
      paymentMethod: payment.paymentMode,
      paymentMode: payment.paymentMode,
      debit: payment.amountPaid,
      credit: 0,
      academicYear: payment.academicYear,
      year: payment.year,
      referenceId: payment.receiptNo,
      status: 'cancelled',
      recordedBy: payment.cancelledByName || 'Administrator',
      remarks: `Reversal of receipt ${payment.receiptNo}. Reason: ${payment.cancelReason || 'Administrative Cancellation'}`
    });
  }

  // Sort chronologically:
  // Primary sort by date
  // Secondary sort: demands (debit) before payments (credit) on the same date
  entries.sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    if (a.type === 'demand' && b.type !== 'demand') return -1;
    if (a.type !== 'demand' && b.type === 'demand') return 1;
    return 0;
  });

  // Calculate chronological running balance
  let runningBalance = 0;
  for (const entry of entries) {
    runningBalance += (entry.debit || 0) - (entry.credit || 0);
    entry.balance = runningBalance;
    entry.runningBalance = runningBalance;
  }

  // Filter entries if filters are supplied
  let filteredEntries = entries;
  if (filters && Object.keys(filters).length > 0) {
    filteredEntries = entries.filter(e => {
      if (filters.academicYear && e.academicYear !== filters.academicYear) return false;
      if (filters.category && e.category !== filters.category && e.feeCategory !== filters.category) return false;
      if (filters.paymentMode && e.paymentMode !== filters.paymentMode && e.paymentMethod !== filters.paymentMode) return false;
      if (filters.status && e.status !== filters.status) return false;
      if (filters.dateFrom && new Date(e.date) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(e.date) > new Date(filters.dateTo + 'T23:59:59.999Z')) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matches = (e.receiptNo && e.receiptNo.toLowerCase().includes(q)) ||
                        (e.transactionId && e.transactionId.toLowerCase().includes(q)) ||
                        (e.description && e.description.toLowerCase().includes(q)) ||
                        (e.category && e.category.toLowerCase().includes(q)) ||
                        (e.recordedBy && e.recordedBy.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }

  return {
    student: {
      studentId: student.studentId,
      name: student.name,
      admissionNo: student.admissionNo,
      course: student.course,
      level: student.level,
      status: student.status
    },
    entries: filteredEntries,
    allEntries: entries,
    totalDebits: entries.reduce((s, e) => s + (e.debit > 0 ? e.debit : 0), 0),
    totalCredits: entries.reduce((s, e) => s + (e.credit > 0 && e.status === 'completed' ? e.credit : 0), 0),
    filteredDebits: filteredEntries.reduce((s, e) => s + (e.debit > 0 ? e.debit : 0), 0),
    filteredCredits: filteredEntries.reduce((s, e) => s + (e.credit > 0 && e.status === 'completed' ? e.credit : 0), 0),
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

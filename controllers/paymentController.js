const Payment = require('../models/Payment');
const Student = require('../models/Student');
const Setting = require('../models/Setting');
const { calculateFeeSummary, validatePaymentAmount } = require('../utils/feeCalculator');
const { createAuditLog, generateReceiptNo } = require('../utils/helpers');

// @desc    Record a payment
// @route   POST /api/payments
exports.recordPayment = async (req, res) => {
  try {
    const {
      studentId,
      academicYear,
      amountPaid,
      paymentDate,
      paymentMode,
      transactionId,
      remarks,
      allocations
    } = req.body;

    // Find student
    const student = await Student.findOne({ studentId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Check for advance payment setting
    const advanceSetting = await Setting.findOne({ key: 'allowAdvancePayment' });
    const allowAdvance = advanceSetting ? advanceSetting.value === true : false;

    // Validate payment amount on backend
    const validation = await validatePaymentAmount(studentId, academicYear, amountPaid, allowAdvance);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        data: { maxAllowed: validation.maxAllowed, remaining: validation.remaining }
      });
    }

    // Generate unique receipt number
    const receiptNo = await generateReceiptNo();

    // Double-check receipt uniqueness
    const existingReceipt = await Payment.findOne({ receiptNo });
    if (existingReceipt) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate receipt number generated. Please retry.'
      });
    }

    // Determine the student's year for this academic year
    const enrollment = student.enrollmentHistory.find(e => e.academicYear === academicYear);
    const year = enrollment ? enrollment.year : student.currentYear;

    const payment = await Payment.create({
      receiptNo,
      student: student._id,
      studentId: student.studentId,
      academicYear,
      year,
      allocations: allocations || [],
      amountPaid: parseFloat(amountPaid),
      paymentDate: paymentDate || new Date(),
      paymentMode,
      transactionId,
      remarks,
      enteredBy: req.user._id,
      enteredByName: req.user.name,
      advanceAmount: validation.advanceAmount || 0,
      status: 'completed'
    });

    // Update student advance credit if applicable
    if (validation.advanceAmount > 0) {
      student.advanceCredit = (student.advanceCredit || 0) + validation.advanceAmount;
      await student.save();
    }

    // Get updated fee summary
    const updatedSummary = await calculateFeeSummary(studentId, academicYear);

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Payment Recorded',
      entity: 'Payment',
      entityId: receiptNo,
      description: `Recorded payment of ₹${amountPaid} for ${student.name} (${studentId})`,
      newValue: {
        receiptNo,
        amountPaid,
        paymentMode,
        academicYear,
        transactionId
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: {
        payment,
        feeSummary: updatedSummary
      },
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Get all payments
// @route   GET /api/payments
exports.getPayments = async (req, res) => {
  try {
    const {
      studentId, academicYear, paymentMode, status,
      dateFrom, dateTo, page = 1, limit = 20
    } = req.query;

    const filter = {};
    if (studentId) filter.studentId = studentId;
    if (academicYear) filter.academicYear = academicYear;
    if (paymentMode) filter.paymentMode = paymentMode;
    if (status) filter.status = status;
    if (dateFrom || dateTo) {
      filter.paymentDate = {};
      if (dateFrom) filter.paymentDate.$gte = new Date(dateFrom);
      if (dateTo) filter.paymentDate.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    const total = await Payment.countDocuments(filter);
    const payments = await Payment.find(filter)
      .populate('student', 'name admissionNo course level')
      .populate('enteredBy', 'name username')
      .sort({ paymentDate: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: payments,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single payment
// @route   GET /api/payments/:id
exports.getPayment = async (req, res) => {
  try {
    const payment = await Payment.findOne({
      $or: [
        { receiptNo: req.params.id },
        { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : undefined }
      ].filter(Boolean)
    })
      .populate('student', 'name admissionNo course level currentYear email phone')
      .populate('enteredBy', 'name username');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Edit payment (Admin only)
// @route   PUT /api/payments/:id
exports.editPayment = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'A reason is required for editing a payment'
      });
    }

    const payment = await Payment.findOne({ receiptNo: req.params.id });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a cancelled payment'
      });
    }

    const oldValue = {
      amountPaid: payment.amountPaid,
      paymentMode: payment.paymentMode,
      transactionId: payment.transactionId,
      remarks: payment.remarks
    };

    // Only allow editing certain fields
    if (req.body.amountPaid !== undefined) payment.amountPaid = parseFloat(req.body.amountPaid);
    if (req.body.paymentMode) payment.paymentMode = req.body.paymentMode;
    if (req.body.transactionId !== undefined) payment.transactionId = req.body.transactionId;
    if (req.body.remarks !== undefined) payment.remarks = req.body.remarks;
    if (req.body.paymentDate) payment.paymentDate = req.body.paymentDate;

    await payment.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Payment Edited',
      entity: 'Payment',
      entityId: payment.receiptNo,
      description: `Edited payment ${payment.receiptNo}`,
      oldValue,
      newValue: {
        amountPaid: payment.amountPaid,
        paymentMode: payment.paymentMode,
        transactionId: payment.transactionId,
        remarks: payment.remarks
      },
      reason,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: payment,
      message: 'Payment updated successfully'
    });
  } catch (error) {
    console.error('Edit payment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Cancel payment (Admin only)
// @route   PATCH /api/payments/:id/cancel
exports.cancelPayment = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'A reason is required for cancelling a payment'
      });
    }

    const payment = await Payment.findOne({ receiptNo: req.params.id });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Payment is already cancelled'
      });
    }

    const oldValue = { status: payment.status, amountPaid: payment.amountPaid };

    payment.status = 'cancelled';
    payment.cancelledBy = req.user._id;
    payment.cancelledAt = new Date();
    payment.cancelReason = reason;

    await payment.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Payment Cancelled',
      entity: 'Payment',
      entityId: payment.receiptNo,
      description: `Cancelled payment ${payment.receiptNo} (₹${payment.amountPaid}) for student ${payment.studentId}`,
      oldValue,
      newValue: { status: 'cancelled', cancelReason: reason },
      reason,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: payment,
      message: 'Payment cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel payment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get today's collection
// @route   GET /api/payments/today
exports.getTodayCollection = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await Payment.aggregate([
      {
        $match: {
          paymentDate: { $gte: today, $lt: tomorrow },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amountPaid' },
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        total: result[0]?.total || 0,
        count: result[0]?.count || 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

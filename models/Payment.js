const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  receiptNo: {
    type: String,
    unique: true,
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  studentId: {
    type: String,
    required: true
  },
  academicYear: {
    type: String,
    required: [true, 'Academic year is required']
  },
  year: {
    type: String,
    required: true
  },
  // Payment allocation: how this payment is distributed
  allocations: [{
    academicYear: { type: String, required: true },
    year: { type: String, required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 }
  }],
  // Total amount paid in this transaction
  amountPaid: {
    type: Number,
    required: [true, 'Amount is required'],
    min: 0
  },
  paymentDate: {
    type: Date,
    required: [true, 'Payment date is required'],
    default: Date.now
  },
  paymentMode: {
    type: String,
    enum: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'Other'],
    required: [true, 'Payment mode is required']
  },
  transactionId: {
    type: String,
    trim: true
  },
  remarks: {
    type: String,
    trim: true
  },
  enteredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  enteredByName: {
    type: String
  },
  status: {
    type: String,
    enum: ['completed', 'cancelled'],
    default: 'completed'
  },
  // If the payment was an advance (excess), track the advance portion
  advanceAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Cancellation details
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancelledAt: {
    type: Date
  },
  cancelReason: {
    type: String
  },
  // Email tracking
  emailSent: {
    type: Boolean,
    default: false
  },
  emailSentAt: {
    type: Date
  },
  emailAddress: {
    type: String
  }
}, {
  timestamps: true
});

paymentSchema.index({ student: 1 });
paymentSchema.index({ studentId: 1 });
paymentSchema.index({ academicYear: 1 });
paymentSchema.index({ paymentDate: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ student: 1, academicYear: 1, status: 1 });

module.exports = mongoose.model('Payment', paymentSchema);

const mongoose = require('mongoose');

const importCommentSchema = new mongoose.Schema({
  importBatchId: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  fileName: {
    type: String,
    trim: true
  },
  worksheetName: {
    type: String,
    required: true,
    trim: true
  },
  cellAddress: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  rowNumber: {
    type: Number,
    index: true
  },
  colLetter: {
    type: String,
    trim: true,
    uppercase: true
  },
  relatedField: {
    type: String,
    trim: true
  },
  originalCellValue: {
    type: mongoose.Schema.Types.Mixed,
    default: ''
  },
  originalCommentText: {
    type: String,
    required: true
  },
  commentAuthor: {
    type: String,
    default: 'Unknown Author',
    trim: true
  },
  commentTimestamp: {
    type: Date,
    default: null
  },
  isThreaded: {
    type: Boolean,
    default: false
  },
  isReply: {
    type: Boolean,
    default: false
  },
  parentCommentId: {
    type: String,
    default: null
  },
  studentId: {
    type: String,
    trim: true,
    index: true,
    default: null
  },
  admissionNo: {
    type: String,
    trim: true,
    index: true,
    default: null
  },
  studentName: {
    type: String,
    trim: true,
    default: null
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    default: null
  },
  suggestedFieldMapping: {
    field: {
      type: String,
      default: null
    },
    detectedReceiptNo: {
      type: String,
      default: null
    },
    detectedTxnId: {
      type: String,
      default: null
    },
    detectedDate: {
      type: Date,
      default: null
    },
    detectedAmount: {
      type: Number,
      default: null
    },
    detectedPaymentMode: {
      type: String,
      default: null
    },
    confidence: {
      type: String,
      enum: ['high', 'medium', 'low', 'none'],
      default: 'none'
    }
  },
  verificationStatus: {
    type: String,
    enum: ['unverified', 'verified', 'mapped', 'ignored'],
    default: 'unverified',
    index: true
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  verifiedByName: {
    type: String,
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  mappedPayment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    default: null
  },
  remarks: {
    type: String,
    trim: true,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

importCommentSchema.index({ importBatchId: 1, cellAddress: 1 });
importCommentSchema.index({ worksheetName: 1, cellAddress: 1 });

module.exports = mongoose.model('ImportComment', importCommentSchema);

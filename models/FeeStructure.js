const mongoose = require('mongoose');

const feeStructureSchema = new mongoose.Schema({
  feeId: {
    type: String,
    unique: true,
    required: true
  },
  course: {
    type: String,
    required: [true, 'Course is required'],
    trim: true
  },
  level: {
    type: String,
    enum: ['UG', 'PG'],
    required: true
  },
  year: {
    type: String,
    required: [true, 'Year is required']
  },
  academicYear: {
    type: String,
    required: [true, 'Academic year is required']
  },
  category: {
    type: String,
    required: [true, 'Fee category is required']
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

feeStructureSchema.index({ course: 1, level: 1, year: 1, academicYear: 1 });
feeStructureSchema.index({ academicYear: 1 });

module.exports = mongoose.model('FeeStructure', feeStructureSchema);

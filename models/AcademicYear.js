const mongoose = require('mongoose');

const academicYearSchema = new mongoose.Schema({
  year: {
    type: String,
    required: [true, 'Academic year is required'],
    trim: true
  },
  course: {
    type: String,
    trim: true,
    default: 'All' // 'All' denotes global default for that year unless overridden by specific course
  },
  studyYear: {
    type: String,
    trim: true,
    default: 'All' // e.g. '1st Year', '2nd Year', '3rd Year', or 'All'
  },
  startDate: {
    type: Date,
    required: [true, 'Start date is required']
  },
  endDate: {
    type: Date,
    required: [true, 'End date is required']
  },
  feeActivationDate: {
    type: Date,
    default: null
  },
  feeDueDate: {
    type: Date,
    default: null
  },
  isCurrent: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound unique index ensuring no duplicates for the same academic year + course + studyYear
academicYearSchema.index({ year: 1, course: 1, studyYear: 1 }, { unique: true });
academicYearSchema.index({ course: 1, studyYear: 1 });
academicYearSchema.index({ status: 1 });

module.exports = mongoose.model('AcademicYear', academicYearSchema);

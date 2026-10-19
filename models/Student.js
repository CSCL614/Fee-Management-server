const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  studentId: {
    type: String,
    unique: true,
    required: true
  },
  admissionNo: {
    type: String,
    unique: true,
    required: [true, 'Admission number is required'],
    trim: true
  },
  name: {
    type: String,
    required: [true, 'Student name is required'],
    trim: true
  },
  course: {
    type: String,
    required: [true, 'Course is required'],
    trim: true
  },
  degree: {
    type: String,
    trim: true
  },
  specialization: {
    type: String,
    trim: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  },
  duration: {
    type: Number
  },
  level: {
    type: String,
    enum: ['UG', 'PG'],
    required: [true, 'Level is required']
  },
  currentYear: {
    type: String,
    required: [true, 'Current year is required']
  },
  currentAcademicYear: {
    type: String,
    required: [true, 'Current academic year is required']
  },
  batchStartYear: {
    type: Number
  },
  batchEndYear: {
    type: Number
  },
  batch: {
    type: String,
    trim: true
  },
  // History of all academic years the student has been enrolled in
  enrollmentHistory: [{
    year: String,           // e.g. "1st Year"
    academicYear: String,   // e.g. "2025-26"
    promotedAt: Date
  }],
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
  },
  fatherName: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  dateOfBirth: {
    type: Date
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other']
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Graduated', 'Discontinued', 'Transferred'],
    default: 'Active'
  },
  advanceCredit: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

studentSchema.pre('validate', function(next) {
  if (!this.batch || !this.batchStartYear || !this.batchEndYear) {
    let startYear;
    if (this.admissionNo) {
      const match = this.admissionNo.match(/\d{4}/);
      if (match) startYear = parseInt(match[0]);
    }
    if (!startYear && this.currentAcademicYear) {
      const parts = this.currentAcademicYear.split('-');
      if (parts[0]) startYear = parseInt(parts[0]);
    }
    if (!startYear) startYear = new Date().getFullYear();

    const duration = this.duration || (this.level === 'PG' ? 2 : 3);
    this.batchStartYear = startYear;
    this.batchEndYear = startYear + duration;
    this.batch = `${this.batchStartYear}-${this.batchEndYear}`;
  }
  next();
});

studentSchema.index({ course: 1 });
studentSchema.index({ level: 1 });
studentSchema.index({ status: 1 });
studentSchema.index({ status: 1, createdAt: -1 });
studentSchema.index({ status: 1, course: 1, level: 1 });
studentSchema.index({ status: 1, currentAcademicYear: 1 });
studentSchema.index({ currentAcademicYear: 1 });
studentSchema.index({ batch: 1 });
studentSchema.index({ course: 1, batch: 1 });
studentSchema.index({ name: 'text' });

module.exports = mongoose.model('Student', studentSchema);

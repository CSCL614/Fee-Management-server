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

studentSchema.index({ course: 1 });
studentSchema.index({ level: 1 });
studentSchema.index({ status: 1 });
studentSchema.index({ currentAcademicYear: 1 });
studentSchema.index({ name: 'text' });

module.exports = mongoose.model('Student', studentSchema);

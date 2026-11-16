const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  courseId: {
    type: String,
    unique: true
  },
  degree: {
    type: String,
    required: [true, 'Degree is required'],
    trim: true,
    enum: ['B.Sc', 'B.Com', 'M.Sc', 'BA', 'BBA', 'BCA', 'MBA', 'MCA']
  },
  specialization: {
    type: String,
    required: [true, 'Specialization is required'],
    trim: true
  },
  courseName: {
    type: String,
    trim: true
  },
  duration: {
    type: Number,
    required: [true, 'Course duration in years is required'],
    min: [1, 'Duration must be at least 1 year'],
    max: [6, 'Duration cannot exceed 6 years']
  },
  level: {
    type: String,
    enum: ['UG', 'PG'],
    required: [true, 'Level is required']
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  receiptCourseCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: null
  }
}, {
  timestamps: true
});

courseSchema.pre('validate', function(next) {
  if (!this.level && this.degree) {
    this.level = this.degree === 'M.Sc' || this.degree === 'MBA' || this.degree === 'MCA' ? 'PG' : 'UG';
  }
  if (!this.courseName && this.degree && this.specialization) {
    this.courseName = `${this.degree} ${this.specialization}`;
  }
  if (!this.receiptCourseCode) {
    const s = (this.specialization || '').toLowerCase();
    const d = (this.degree || '').toLowerCase();
    if (s.includes('zoology')) this.receiptCourseCode = 'ZOO';
    else if (s.includes('organic')) this.receiptCourseCode = 'ORG';
    else if (s.includes('chemistry')) this.receiptCourseCode = 'CHE';
    else if (s.includes('computer science')) this.receiptCourseCode = 'CSC';
    else if (s.includes('computer application')) this.receiptCourseCode = 'CCA';
    else if (d === 'bca') this.receiptCourseCode = 'BCA';
    else if (d === 'mca') this.receiptCourseCode = 'MCA';
    else if (d === 'mba') this.receiptCourseCode = 'MBA';
    else this.receiptCourseCode = (this.specialization || this.degree || 'GEN').replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
  }
  next();
});

courseSchema.index({ degree: 1, specialization: 1 }, { unique: true });
courseSchema.index({ status: 1 });

module.exports = mongoose.model('Course', courseSchema);

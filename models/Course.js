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
  next();
});

courseSchema.index({ degree: 1, specialization: 1 }, { unique: true });
courseSchema.index({ status: 1 });

module.exports = mongoose.model('Course', courseSchema);

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
  rollNo: {
    type: String,
    trim: true,
    default: null
  },
  admissionYear: {
    type: Number,
    default: null
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
  profilePhoto: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Graduated', 'Discontinued', 'Transferred', 'Archived'],
    default: 'Active'
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: {
    type: Date,
    default: null
  },
  archivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  archiveReason: {
    type: String,
    trim: true
  },
  advanceCredit: {
    type: Number,
    default: 0,
    min: 0
  },
  // Graduation and Academic Results Details
  graduation: {
    passingYear: {
      type: Number,
      default: null
    },
    passingAcademicYear: {
      type: String,
      trim: true,
      default: null
    },
    completionDate: {
      type: Date,
      default: null
    },
    graduatedAt: {
      type: Date,
      default: null
    },
    graduatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    graduatedByName: {
      type: String,
      trim: true
    },
    graduationRemarks: {
      type: String,
      trim: true
    },
    academicResult: {
      course: String,
      specialization: String,
      admissionYear: Number,
      passingYear: Number,
      finalAcademicYear: String,
      finalSemester: String,
      resultStatus: {
        type: String,
        enum: [
          'Passed',
          'Passed with Distinction',
          'First Class Distinction',
          'First Class',
          'Second Class',
          'Third Class',
          'Passed with Compartment',
          'Awaiting Result',
          'Awaited',
          'Not Updated',
          'Other'
        ],
        default: 'Not Updated'
      },
      percentage: {
        type: Number,
        min: 0,
        max: 100,
        default: null
      },
      cgpa: {
        type: Number,
        min: 0,
        max: 10,
        default: null
      },
      grade: {
        type: String,
        trim: true,
        default: null
      },
      gradeOrDivision: {
        type: String,
        trim: true,
        default: null
      },
      universityRegNo: {
        type: String,
        trim: true,
        default: null
      },
      resultDate: {
        type: Date,
        default: null
      },
      resultPublicationDate: {
        type: Date,
        default: null
      },
      remarks: {
        type: String,
        trim: true,
        default: null
      },
      updatedAt: Date,
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      updatedByName: String
    },
    restorationHistory: [{
      restoredAt: {
        type: Date,
        default: Date.now
      },
      restoredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      restoredByName: String,
      previousStatus: String,
      reason: {
        type: String,
        required: true,
        trim: true
      }
    }]
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
studentSchema.index({ status: 1, 'graduation.passingYear': 1 });
studentSchema.index({ status: 1, 'graduation.passingAcademicYear': 1 });
studentSchema.index({ 'graduation.passingYear': 1 });
studentSchema.index({ name: 'text' });

module.exports = mongoose.model('Student', studentSchema);

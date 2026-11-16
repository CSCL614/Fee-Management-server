const mongoose = require('mongoose');

// Fee Demand represents the formal fee assessment for a student in a specific academic year.
// This is the total amount the student is expected to pay for that year.
const feeDemandSchema = new mongoose.Schema({
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
    required: [true, 'Year is required']
  },
  course: {
    type: String,
    required: true
  },
  level: {
    type: String,
    enum: ['UG', 'PG'],
    required: true
  },
  // Individual fee categories and their amounts for this demand
  categories: [{
    category: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    originalAmount: { type: Number, default: null },
    concession: { type: Number, default: 0, min: 0 },
    frequency: { type: String, enum: ['ONE_TIME', 'ANNUAL', 'SEMESTER', 'CUSTOM'], default: 'ANNUAL' },
    semester: { type: String, default: null },
    activationDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    status: { type: String, enum: ['active', 'upcoming', 'paid', 'partially_paid'], default: 'active' }
  }],
  // Traceable tuition fee concession for this academic year
  concession: {
    amount: { type: Number, default: 0, min: 0 },
    originalTuitionFee: { type: Number, default: 0 },
    reason: { type: String, trim: true },
    appliedAt: { type: Date, default: null },
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    appliedByName: { type: String },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName: { type: String }
  },
  // Total demand amount (sum of all categories after concession)
  totalDemand: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'cancelled'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

feeDemandSchema.index({ student: 1, academicYear: 1 });
feeDemandSchema.index({ student: 1, status: 1 });
feeDemandSchema.index({ status: 1, totalDemand: 1 });
feeDemandSchema.index({ status: 1, 'categories.activationDate': 1 });
feeDemandSchema.index({ studentId: 1 });
feeDemandSchema.index({ academicYear: 1 });
feeDemandSchema.index({ course: 1 });
feeDemandSchema.index({ student: 1, academicYear: 1, 'categories.category': 1, 'categories.semester': 1 });

module.exports = mongoose.model('FeeDemand', feeDemandSchema);

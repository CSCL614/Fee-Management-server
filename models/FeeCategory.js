const mongoose = require('mongoose');

const feeCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  frequency: {
    type: String,
    enum: ['ONE_TIME', 'ANNUAL', 'SEMESTER', 'CUSTOM'],
    default: 'ANNUAL'
  },
  semester: {
    type: String,
    default: null
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('FeeCategory', feeCategorySchema);

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userName: {
    type: String
  },
  userRole: {
    type: String
  },
  action: {
    type: String,
    required: [true, 'Action is required']
  },
  entity: {
    type: String,
    required: true  // 'Student', 'Payment', 'FeeStructure', etc.
  },
  entityId: {
    type: String
  },
  description: {
    type: String
  },
  oldValue: {
    type: mongoose.Schema.Types.Mixed
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed
  },
  reason: {
    type: String
  },
  ipAddress: {
    type: String
  }
}, {
  timestamps: false
});

auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ entity: 1, entityId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);

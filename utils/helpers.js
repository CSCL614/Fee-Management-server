const AuditLog = require('../models/AuditLog');

/**
 * Create an audit log entry.
 */
async function createAuditLog({
  user,
  userName,
  userRole,
  action,
  entity,
  entityId,
  description,
  oldValue,
  newValue,
  reason,
  ipAddress
}) {
  try {
    await AuditLog.create({
      timestamp: new Date(),
      user,
      userName: userName || 'System',
      userRole: userRole || 'system',
      action,
      entity,
      entityId,
      description,
      oldValue,
      newValue,
      reason,
      ipAddress
    });
  } catch (error) {
    console.error('Audit log creation failed:', error.message);
  }
}

/**
 * Generate a unique sequential ID.
 */
async function generateId(Model, prefix, field = 'studentId') {
  const last = await Model.findOne().sort({ [field]: -1 }).select(field);
  if (!last || !last[field]) {
    return `${prefix}-0001`;
  }
  const lastNum = parseInt(last[field].split('-').pop());
  const nextNum = (lastNum + 1).toString().padStart(4, '0');
  return `${prefix}-${nextNum}`;
}

/**
 * Generate a unique receipt number: REC-YYYY-NNNNN
 */
async function generateReceiptNo() {
  const Payment = require('../models/Payment');
  const year = new Date().getFullYear();
  const prefix = `REC-${year}`;

  const lastPayment = await Payment.findOne({
    receiptNo: new RegExp(`^${prefix}`)
  }).sort({ receiptNo: -1 });

  if (!lastPayment) {
    return `${prefix}-00001`;
  }

  const lastNum = parseInt(lastPayment.receiptNo.split('-').pop());
  const nextNum = (lastNum + 1).toString().padStart(5, '0');
  return `${prefix}-${nextNum}`;
}

/**
 * Format currency in Indian format.
 */
function formatIndianCurrency(amount) {
  if (amount === undefined || amount === null) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

module.exports = {
  createAuditLog,
  generateId,
  generateReceiptNo,
  formatIndianCurrency
};

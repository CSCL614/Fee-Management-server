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
  const items = await Model.find({
    [field]: new RegExp(`^${prefix}`)
  }).select(field);

  let maxNum = 0;
  for (const item of items) {
    if (item[field]) {
      const num = parseInt(item[field].split('-').pop(), 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let candidateNum = maxNum + 1;
  let id = `${prefix}-${candidateNum.toString().padStart(4, '0')}`;
  while (await Model.exists({ [field]: id })) {
    candidateNum++;
    id = `${prefix}-${candidateNum.toString().padStart(4, '0')}`;
  }
  return id;
}

/**
 * Generate a unique receipt number: REC-YYYY-NNNNN
 */
async function generateReceiptNo() {
  const Payment = require('../models/Payment');
  const year = new Date().getFullYear();
  const prefix = `REC-${year}`;

  const payments = await Payment.find({
    receiptNo: new RegExp(`^${prefix}`)
  }).select('receiptNo');

  let maxNum = 0;
  for (const p of payments) {
    if (p.receiptNo) {
      const parts = p.receiptNo.split('-');
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let candidateNum = maxNum + 1;
  let receiptNo = `${prefix}-${candidateNum.toString().padStart(5, '0')}`;

  while (await Payment.exists({ receiptNo })) {
    candidateNum++;
    receiptNo = `${prefix}-${candidateNum.toString().padStart(5, '0')}`;
  }

  return receiptNo;
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

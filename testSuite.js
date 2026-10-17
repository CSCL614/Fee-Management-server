require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const Payment = require('./models/Payment');
const Student = require('./models/Student');
const User = require('./models/User');
const Course = require('./models/Course');
const { generateReceiptNo, generateId, formatIndianCurrency } = require('./utils/helpers');
const { calculateFeeSummary, validatePaymentAmount } = require('./utils/feeCalculator');

// Connect to Database before tests and close after
test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
});

test.after(async () => {
  await mongoose.connection.close();
});

test('Test Case 1: Receipt Number Generation & Duplicate Prevention', async (t) => {
  await t.test('Should generate a valid, non-colliding receipt number for current year', async () => {
    const currentYear = new Date().getFullYear();
    const receiptNo = await generateReceiptNo();
    
    assert.match(receiptNo, new RegExp(`^REC-${currentYear}-\\d{5}$`), 'Receipt format must be REC-YYYY-NNNNN');

    const exists = await Payment.exists({ receiptNo });
    assert.strictEqual(exists, null, `Generated receipt number ${receiptNo} must not already exist in the database`);
  });

  await t.test('Should handle mixed 4-digit and 5-digit receipts without alphabetical sorting trap', async () => {
    // Current database contains REC-2026-0001, REC-2026-0002, REC-2026-00003, REC-2026-00004
    const receiptNo = await generateReceiptNo();
    const sequenceNum = parseInt(receiptNo.split('-').pop(), 10);
    assert.ok(sequenceNum >= 5, `Next sequence number (${sequenceNum}) should be 5 or higher`);
  });
});

test('Test Case 2: Sequential ID Generator (generateId)', async (t) => {
  await t.test('Should generate formatted sequential student ID', async () => {
    const studentId = await generateId(Student, 'STU', 'studentId');
    assert.match(studentId, /^STU-\d{4}$/, 'Student ID must match format STU-NNNN');

    const exists = await Student.exists({ studentId });
    assert.strictEqual(exists, null, `Generated studentId ${studentId} must be unique`);
  });

  await t.test('Should generate formatted sequential course ID', async () => {
    const courseId = await generateId(Course, 'CRS', 'courseId');
    assert.match(courseId, /^CRS-\d{4}$/, 'Course ID must match format CRS-NNNN');
  });
});

test('Test Case 3: Indian Currency Formatter', () => {
  assert.strictEqual(formatIndianCurrency(0), '₹0');
  assert.strictEqual(formatIndianCurrency(1000), '₹1,000');
  assert.strictEqual(formatIndianCurrency(10000), '₹10,000');
  assert.strictEqual(formatIndianCurrency(150000), '₹1,50,000');
  assert.strictEqual(formatIndianCurrency(null), '₹0');
});

test('Test Case 4: Fee Calculator & Ledger Accounting (Live Student: Sathyavathi)', async () => {
  const student = await Student.findOne({ admissionNo: 'UG2026BCOM001' });
  assert.ok(student, 'Student Sathyavathi (UG2026BCOM001) should exist in DB');

  const summary = await calculateFeeSummary(student.studentId, '2026-27');
  
  assert.strictEqual(summary.student.admissionNo, 'UG2026BCOM001');
  assert.strictEqual(summary.overall.totalFee, 10000, 'Assessed fee should be ₹10,000');
  assert.strictEqual(summary.overall.totalPaid, 8000, 'Total paid should be ₹8,000 (after REC-2026-00004)');
  assert.strictEqual(summary.overall.totalPending, 2000, 'Remaining pending fee should be ₹2,000');
  assert.strictEqual(summary.overall.status, 'Partial', 'Payment status should be Partial');
});

test('Test Case 5: Payment Amount Validation Logic', async (t) => {
  const student = await Student.findOne({ admissionNo: 'UG2026BCOM001' });
  assert.ok(student);

  await t.test('Allow valid payment less than or equal to pending amount (₹2,000)', async () => {
    const result = await validatePaymentAmount(student.studentId, '2026-27', 2000, false);
    assert.strictEqual(result.valid, true, 'Payment of remaining ₹2,000 should be valid');
  });

  await t.test('Disallow overpayment when advance payments are disabled', async () => {
    const result = await validatePaymentAmount(student.studentId, '2026-27', 5000, false);
    assert.strictEqual(result.valid, false, 'Payment of ₹5,000 should be rejected because pending is only ₹2,000');
    assert.strictEqual(result.remaining, 2000);
  });
});

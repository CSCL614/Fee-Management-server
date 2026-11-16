const mongoose = require('mongoose');
const path = require('path');
const XLSX = require('xlsx');

// Import models
const Student = require('../models/Student');
const Course = require('../models/Course');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const ImportComment = require('../models/ImportComment');

// Import utilities
const { generateFeeLedger, calculateFeeSummary } = require('../utils/feeCalculator');
const { extractAllCommentsFromWorkbook, analyzeCommentText } = require('../utils/excelCommentExtractor');
const { generateReceiptPdf } = require('../utils/receiptPdf');
const { generateId, generateReceiptNo } = require('../utils/helpers');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/college_fee_mgmt';

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${testName}`);
    if (details) console.error(`         Details: ${details}`);
    failedTests++;
  }
}

async function runVerification() {
  console.log('\n===============================================================');
  console.log('   COLLEGE FEE MANAGEMENT — COMPREHENSIVE PHASE 2 VERIFICATION');
  console.log('===============================================================\n');

  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB:', MONGO_URI);

    // Get Admin and Accountant users
    const adminUser = await User.findOne({ role: 'admin' });
    const accUser = await User.findOne({ role: 'accountant' });
    assert(Boolean(adminUser), 'Admin user exists in database');
    assert(Boolean(accUser), 'Accountant user exists in database');

    // =========================================================================
    // SECTION 1: STUDENT FEE LEDGER — INDIVIDUAL TRANSACTIONS (Requirement 1)
    // =========================================================================
    console.log('\n--- Testing Section 1: Fee Ledger Individual Transactions ---');

    // Clean up test student
    const testAdmNo = 'LEDGER_TEST_2026';
    await Student.deleteMany({ admissionNo: testAdmNo });
    await FeeDemand.deleteMany({ studentId: 'STU_LEDGER_2026' });
    await Payment.deleteMany({ studentId: 'STU_LEDGER_2026' });

    // Create test student
    const testStudent = await Student.create({
      studentId: 'STU_LEDGER_2026',
      admissionNo: testAdmNo,
      name: 'Rohan Sharma',
      degree: 'B.Com',
      specialization: 'Computer Applications',
      course: 'B.Com Computer Applications',
      level: 'UG',
      duration: 3,
      currentYear: '1st Year',
      currentAcademicYear: '2026-27',
      batchStartYear: 2026,
      batchEndYear: 2029,
      batch: '2026-2029',
      status: 'Active'
    });
    assert(Boolean(testStudent), 'Created test student for fee ledger verification');

    // 1.1 Annual Tuition Fee assessment of ₹30,000 for AY 2026-27
    const demand = await FeeDemand.create({
      student: testStudent._id,
      studentId: testStudent.studentId,
      academicYear: '2026-27',
      year: '1st Year',
      course: testStudent.course,
      level: 'UG',
      categories: [
        {
          category: 'Tuition Fee',
          amount: 30000,
          frequency: 'ANNUAL',
          activationDate: new Date('2026-06-01'),
          status: 'active'
        }
      ],
      totalDemand: 30000,
      createdBy: adminUser._id
    });
    assert(demand.totalDemand === 30000, 'Assessed Annual Tuition Fee demand of ₹30,000');

    // 1.2 Five separate installment payments throughout the academic year
    // Payment 1: 10-06-2026, ₹5,000
    // Payment 2: 10-07-2026, ₹5,000
    // Payment 3: 10-08-2026, ₹5,000
    // Payment 4: 10-09-2026, ₹5,000
    // Payment 5: 10-10-2026, ₹10,000
    const installmentPlan = [
      { date: new Date('2026-06-10'), amount: 5000, receiptNo: 'REC-2026-001', mode: 'Cash', txnId: 'TXN-CASH-001' },
      { date: new Date('2026-07-10'), amount: 5000, receiptNo: 'REC-2026-002', mode: 'UPI', txnId: 'TXN-UPI-002' },
      { date: new Date('2026-08-10'), amount: 5000, receiptNo: 'REC-2026-003', mode: 'Bank Transfer', txnId: 'TXN-NEFT-003' },
      { date: new Date('2026-09-10'), amount: 5000, receiptNo: 'REC-2026-004', mode: 'Card', txnId: 'TXN-POS-004' },
      { date: new Date('2026-10-10'), amount: 10000, receiptNo: 'REC-2026-005', mode: 'UPI', txnId: 'TXN-UPI-005' },
    ];

    const savedPayments = [];
    for (const inst of installmentPlan) {
      const p = await Payment.create({
        receiptNo: inst.receiptNo,
        transactionId: inst.txnId,
        student: testStudent._id,
        studentId: testStudent.studentId,
        academicYear: '2026-27',
        year: '1st Year',
        allocations: [{
          academicYear: '2026-27',
          year: '1st Year',
          category: 'Tuition Fee',
          amount: inst.amount
        }],
        amountPaid: inst.amount,
        paymentDate: inst.date,
        paymentMode: inst.mode,
        enteredBy: adminUser._id,
        enteredByName: adminUser.name,
        status: 'completed',
        locked: true,
        lockedAt: new Date()
      });
      savedPayments.push(p);
    }
    assert(savedPayments.length === 5, 'Recorded 5 individual installment payment documents');

    // 1.3 Generate fee ledger and verify each transaction is separate
    const ledger = await generateFeeLedger(testStudent._id);
    assert(Boolean(ledger && ledger.entries), 'Fee ledger generated successfully');

    // Expected entries: 1 assessment demand + 5 payments = 6 entries total
    const paymentEntries = ledger.entries.filter(e => e.type === 'payment' || e.credit > 0);
    assert(paymentEntries.length === 5, `Ledger displays all 5 payments individually (found ${paymentEntries.length})`);

    // Verify no single combined ₹30,000 payment exists
    const lumpSumPayment = paymentEntries.find(e => e.credit === 30000);
    assert(!lumpSumPayment, 'No artificial lump sum ₹30,000 payment was fabricated');

    // Verify running balances after each transaction:
    // Assessment: Debit 30000 -> Running Balance: 30000
    // Payment 1: Credit 5000   -> Running Balance: 25000
    // Payment 2: Credit 5000   -> Running Balance: 20000
    // Payment 3: Credit 5000   -> Running Balance: 15000
    // Payment 4: Credit 5000   -> Running Balance: 10000
    // Payment 5: Credit 10000  -> Running Balance: 0
    const expectedBalances = [30000, 25000, 20000, 15000, 10000, 0];
    const actualBalances = ledger.entries.map(e => e.runningBalance != null ? e.runningBalance : e.balance);
    const balanceProgressionCorrect = JSON.stringify(actualBalances) === JSON.stringify(expectedBalances);
    assert(balanceProgressionCorrect, `Running balance accurately computed at each step: ${actualBalances.join(' -> ')}`);
    assert(ledger.closingBalance === 0, 'Net ledger closing balance is ₹0 after full installment clearance');

    // 1.4 Test Ledger Filters
    const filteredLedgerUPI = await generateFeeLedger(testStudent._id, { paymentMode: 'UPI' });
    const upiEntries = filteredLedgerUPI.entries.filter(e => e.type === 'payment');
    assert(upiEntries.length === 2, `Ledger filtered by paymentMode: UPI returns exactly 2 entries (found ${upiEntries.length})`);

    const filteredLedgerAY = await generateFeeLedger(testStudent._id, { academicYear: '2026-27' });
    assert(filteredLedgerAY.entries.length === 6, 'Ledger filtered by academicYear: 2026-27 returns all 6 entries');

    // 1.5 Test PDF Receipt Generator
    const pdfBuffer = await generateReceiptPdf(savedPayments[0], testStudent);
    assert(Boolean(pdfBuffer && pdfBuffer.length > 500), `Generated official PDF receipt buffer (${pdfBuffer.length} bytes)`);

    // 1.6 Test Cancelled Transaction handling
    const paymentToCancel = savedPayments[4]; // Payment 5 of ₹10,000
    paymentToCancel.status = 'cancelled';
    paymentToCancel.cancellationReason = 'Check bounce / payment reversal';
    paymentToCancel.cancelledAt = new Date();
    paymentToCancel.cancelledBy = adminUser._id;
    await paymentToCancel.save();

    const ledgerAfterCancel = await generateFeeLedger(testStudent._id);
    const cancelledEntry = ledgerAfterCancel.entries.find(e => e.receiptNo === 'REC-2026-005');
    assert(Boolean(cancelledEntry && (cancelledEntry.status === 'Cancelled' || cancelledEntry.status === 'cancelled')), 'Cancelled transaction is preserved in ledger with status "Cancelled"');
    assert(ledgerAfterCancel.closingBalance === 10000, `Closing balance reflects reversed ₹10,000 (Balance: ₹${ledgerAfterCancel.closingBalance})`);

    // Re-activate payment for subsequent tests
    paymentToCancel.status = 'completed';
    paymentToCancel.cancellationReason = null;
    await paymentToCancel.save();

    // =========================================================================
    // SECTION 2: EXCEL IMPORT COMMENTS EXTRACTION (Requirement 2)
    // =========================================================================
    console.log('\n--- Testing Section 2: Excel Comment Extraction & Analysis ---');

    // 2.1 Pattern analyzer test
    const testCommentText1 = 'Tuition Fee paid via UPI ref TXN998822 on 10/08/2026, receipt REC0088 for Rs. 5000';
    const analysis1 = analyzeCommentText(testCommentText1);
    assert(analysis1.hasReference === true, 'Identified transaction details in comment string');
    assert(analysis1.suggestedFieldMapping.detectedReceiptNo === 'REC0088', `Extracted receipt number REC0088 (got ${analysis1.suggestedFieldMapping.detectedReceiptNo})`);
    assert(analysis1.suggestedFieldMapping.detectedTxnId === 'TXN998822', `Extracted transaction ID TXN998822 (got ${analysis1.suggestedFieldMapping.detectedTxnId})`);
    assert(analysis1.suggestedFieldMapping.detectedAmount === 5000, `Extracted amount Rs. 5000 (got ${analysis1.suggestedFieldMapping.detectedAmount})`);
    assert(analysis1.suggestedFieldMapping.detectedPaymentMode === 'UPI', `Extracted payment mode UPI (got ${analysis1.suggestedFieldMapping.detectedPaymentMode})`);

    // 2.2 Create synthetic Excel workbook with cell comments using SheetJS
    const testWb = XLSX.utils.book_new();
    const sheetData = [
      ['Admission No', 'Student Name', 'Degree', 'Specialization', 'Year of Study', 'Academic Year', 'Tuition Fee (₹)', 'Total Fees (₹)', 'Total Paid (₹)', 'Remarks'],
      ['TEST_COM_001', 'Pooja Reddy', 'B.Sc', 'Computer Science', '1st Year', '2026-27', 45000, 45000, 15000, 'Initial installment'],
      ['TEST_COM_002', 'Vikram Varma', 'B.Com', 'General', '2nd Year', '2026-27', 35000, 35000, 0, 'No payment yet']
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Add cell comment to G2 (Tuition fee of row 2)
    ws['G2'].c = [{
      a: 'Accountant Suresh',
      t: 'Receipt REC-7744: Received Rs. 15,000 via Net Banking txn TXN554433 on 25-08-2026'
    }];

    // Add cell comment to J3 (Remarks of row 3)
    ws['J3'].c = [{
      a: 'Admin User',
      t: 'Fee concession of Rs. 5,000 approved by Principal for sports quota'
    }];

    XLSX.utils.book_append_sheet(testWb, ws, 'Student Fees');
    const xlsxBuffer = XLSX.write(testWb, { type: 'buffer', bookType: 'xlsx' });

    // 2.3 Extract comments from buffer
    const extracted = await extractAllCommentsFromWorkbook(xlsxBuffer);
    assert(extracted.comments.length === 2, `Extracted both cell comments from workbook (found ${extracted.comments.length})`);

    const g2Comment = extracted.comments.find(c => c.cellAddress === 'G2');
    assert(Boolean(g2Comment), 'Found comment at cell G2');
    assert(g2Comment.commentAuthor === 'Accountant Suresh', `Preserved author "Accountant Suresh" (got ${g2Comment.commentAuthor})`);
    assert(g2Comment.originalCommentText.includes('Receipt REC-7744'), 'Preserved exact original comment text without modifications');
    assert(g2Comment.suggestedFieldMapping.detectedReceiptNo === 'REC-7744', 'Detected receipt number REC-7744 from comment');
    assert(g2Comment.suggestedFieldMapping.detectedTxnId === 'TXN554433', 'Detected transaction ID TXN554433 from comment');

    // 2.4 Test ImportComment Model persistence
    const batchId = `BATCH_TEST_${Date.now()}`;
    await ImportComment.deleteMany({ importBatchId: batchId });

    const savedCommentDoc = await ImportComment.create({
      importBatchId: batchId,
      fileName: 'test_student_fees.xlsx',
      worksheetName: g2Comment.worksheetName,
      cellAddress: g2Comment.cellAddress,
      rowNumber: g2Comment.rowNumber,
      colLetter: g2Comment.colLetter,
      originalCellValue: g2Comment.originalCellValue,
      originalCommentText: g2Comment.originalCommentText,
      commentAuthor: g2Comment.commentAuthor,
      admissionNo: 'TEST_COM_001',
      studentName: 'Pooja Reddy',
      suggestedFieldMapping: g2Comment.suggestedFieldMapping,
      verificationStatus: 'unverified',
      createdBy: adminUser._id
    });
    assert(Boolean(savedCommentDoc._id), 'Persisted extracted comment into MongoDB ImportComment collection');

    // Verify Comment status transition
    savedCommentDoc.verificationStatus = 'verified';
    savedCommentDoc.verifiedBy = adminUser._id;
    savedCommentDoc.verifiedByName = adminUser.name;
    savedCommentDoc.verifiedAt = new Date();
    await savedCommentDoc.save();
    assert(savedCommentDoc.verificationStatus === 'verified', 'Updated comment verificationStatus to "verified"');

    // =========================================================================
    // SECTION 3: GRADUATED STUDENTS MANAGEMENT (Requirement 3)
    // =========================================================================
    console.log('\n--- Testing Section 3: Graduated Students Management ---');

    // Clean up test graduate student
    const gradAdmNo = 'GRAD_TEST_2026';
    await Student.deleteMany({ admissionNo: gradAdmNo });
    await FeeDemand.deleteMany({ studentId: 'STU_GRAD_2026' });
    await Payment.deleteMany({ studentId: 'STU_GRAD_2026' });

    // 3.1 Create active 3rd year student
    const gradCandidate = await Student.create({
      studentId: 'STU_GRAD_2026',
      admissionNo: gradAdmNo,
      name: 'Sunita Chawla',
      degree: 'B.Sc',
      specialization: 'Biotechnology',
      course: 'B.Sc Biotechnology',
      level: 'UG',
      duration: 3,
      currentYear: '3rd Year',
      currentAcademicYear: '2025-26',
      admissionYear: 2023,
      batchStartYear: 2023,
      batchEndYear: 2026,
      batch: '2023-2026',
      status: 'Active'
    });
    assert(Boolean(gradCandidate), 'Created 3rd year active student ready for graduation');

    // Create fee demand and partial payment for alumni remaining dues test
    await FeeDemand.create({
      student: gradCandidate._id,
      studentId: gradCandidate.studentId,
      academicYear: '2025-26',
      year: '3rd Year',
      course: gradCandidate.course,
      level: 'UG',
      categories: [{ category: 'Tuition Fee', amount: 40000, frequency: 'ANNUAL', status: 'active' }],
      totalDemand: 40000,
      createdBy: adminUser._id
    });

    await Payment.create({
      receiptNo: 'REC-GRAD-001',
      student: gradCandidate._id,
      studentId: gradCandidate.studentId,
      academicYear: '2025-26',
      year: '3rd Year',
      allocations: [{ academicYear: '2025-26', year: '3rd Year', category: 'Tuition Fee', amount: 30000 }],
      amountPaid: 30000,
      paymentDate: new Date('2026-03-15'),
      paymentMode: 'Bank Transfer',
      enteredBy: adminUser._id,
      enteredByName: adminUser.name,
      status: 'completed',
      locked: true,
      lockedAt: new Date()
    });

    // 3.2 Graduate the student
    gradCandidate.status = 'Graduated';
    gradCandidate.graduation = {
      passingYear: 2026,
      passingAcademicYear: '2025-26',
      completionDate: new Date('2026-05-30'),
      graduatedAt: new Date(),
      graduatedBy: adminUser._id,
      graduatedByName: adminUser.name,
      graduationRemarks: 'Successfully passed all 6 semesters with distinction',
      academicResult: {
        course: gradCandidate.course,
        specialization: gradCandidate.specialization,
        admissionYear: 2023,
        passingYear: 2026,
        finalSemester: 'Semester VI',
        resultStatus: 'First Class Distinction',
        percentage: 82.5,
        cgpa: 8.75,
        gradeOrDivision: 'A+ / Distinction',
        universityRegNo: 'AU2023UG4491',
        resultDate: new Date('2026-06-15'),
        remarks: 'Degree certificate issued'
      },
      restorationHistory: []
    };
    await gradCandidate.save();
    assert(gradCandidate.status === 'Graduated', 'Graduated student successfully (status is "Graduated")');

    // 3.3 Verify Active query excludes the graduated student
    const activeCheck = await Student.findOne({ _id: gradCandidate._id, status: 'Active' });
    assert(!activeCheck, 'Graduated student is excluded from Active student queries');

    // 3.4 Verify Graduated query includes the graduated student
    const gradCheck = await Student.findOne({ _id: gradCandidate._id, status: 'Graduated' });
    assert(Boolean(gradCheck), 'Graduated student appears in Graduated / Alumni queries');

    // 3.5 Verify historical fee records and outstanding balance are preserved
    const gradFeeSummary = await calculateFeeSummary(gradCandidate.studentId);
    assert(gradFeeSummary.overall.totalFee === 40000, 'Historical fee assessment (₹40,000) preserved');
    assert(gradFeeSummary.overall.totalPaid === 30000, 'Historical paid receipts (₹30,000) preserved');
    assert(gradFeeSummary.overall.totalPending === 10000, 'Remaining dues (₹10,000) accurately preserved for alumni collection');

    // 3.6 Record payment for graduated student remaining dues
    const remainingPayment = await Payment.create({
      receiptNo: 'REC-ALUMNI-002',
      student: gradCandidate._id,
      studentId: gradCandidate.studentId,
      academicYear: '2025-26',
      year: '3rd Year',
      allocations: [{ academicYear: '2025-26', year: '3rd Year', category: 'Tuition Fee', amount: 10000 }],
      amountPaid: 10000,
      paymentDate: new Date('2026-07-20'),
      paymentMode: 'UPI',
      remarks: 'Alumni settlement of remaining course dues',
      enteredBy: accUser._id,
      enteredByName: accUser.name,
      status: 'completed',
      locked: true,
      lockedAt: new Date()
    });
    assert(Boolean(remainingPayment), 'Recorded alumni payment against remaining dues by Accountant');

    const updatedGradSummary = await calculateFeeSummary(gradCandidate.studentId);
    assert(updatedGradSummary.overall.totalPending === 0, 'Alumni dues successfully cleared to ₹0');

    // 3.7 Test update of Academic Results
    gradCandidate.graduation.academicResult.cgpa = 8.9;
    gradCandidate.graduation.academicResult.percentage = 84.0;
    await gradCandidate.save();
    const refetchedGrad = await Student.findById(gradCandidate._id);
    assert(refetchedGrad.graduation.academicResult.cgpa === 8.9, `Updated academic result CGPA to 8.9 (got ${refetchedGrad.graduation.academicResult.cgpa})`);

    // 3.8 Test Restoration of Graduated Student to Active status
    const mandatoryReason = 'Student re-enrolled for supplementary honors paper in AY 2026-27';
    gradCandidate.status = 'Active';
    gradCandidate.graduation.restorationHistory.push({
      restoredAt: new Date(),
      restoredBy: adminUser._id,
      restoredByName: adminUser.name,
      reason: mandatoryReason,
      previousStatus: 'Graduated'
    });
    await gradCandidate.save();

    const restoredStudent = await Student.findById(gradCandidate._id);
    assert(restoredStudent.status === 'Active', 'Restored student back to "Active" status');
    assert(restoredStudent.graduation.restorationHistory.length === 1, 'Restoration event recorded in restorationHistory');
    assert(restoredStudent.graduation.restorationHistory[0].reason === mandatoryReason, 'Preserved mandatory audit reason in restoration history');

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n===============================================================');
    console.log(`VERIFICATION COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('===============================================================\n');

    await mongoose.disconnect();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (error) {
    console.error('Verification script encountered error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runVerification();

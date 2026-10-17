const mongoose = require('mongoose');

async function seedHistory() {
  await mongoose.connect('mongodb://localhost:27017/college_fee_mgmt');
  console.log('Connected to MongoDB');

  const Student = require('../models/Student');
  const FeeDemand = require('../models/FeeDemand');
  const FeeStructure = require('../models/FeeStructure');
  const Payment = require('../models/Payment');
  const User = require('../models/User');
  const Course = require('../models/Course');
  const { calculateFeeSummary, generateFeeLedger } = require('../utils/feeCalculator');

  const admin = await User.findOne({ role: 'admin' });
  const adminId = admin ? admin._id : new mongoose.Types.ObjectId();
  const adminName = admin ? admin.name : 'Dr. Ramesh Kumar';

  // 1. Get courses
  const bscCourse = await Course.findOne({ degree: 'B.Sc', specialization: 'Chemistry' });
  const mscCourse = await Course.findOne({ degree: 'M.Sc', specialization: 'Organic Chemistry' });

  // 2. Clear old test demands and payments
  await FeeDemand.deleteMany({});
  await Payment.deleteMany({});
  await FeeStructure.deleteMany({});

  // 3. Create Fee Structures
  await FeeStructure.create([
    // B.Sc Chemistry 1st Year (2025-26)
    { feeId: 'FEE-0001', course: 'B.Sc Chemistry', level: 'UG', year: '1st Year', academicYear: '2025-26', category: 'Tuition Fee', amount: 35000, frequency: 'ANNUAL', status: 'active' },
    { feeId: 'FEE-0002', course: 'B.Sc Chemistry', level: 'UG', year: '1st Year', academicYear: '2025-26', category: 'Admission Fee', amount: 5000, frequency: 'ONE_TIME', status: 'active' },
    { feeId: 'FEE-0003', course: 'B.Sc Chemistry', level: 'UG', year: '1st Year', academicYear: '2025-26', category: 'Laboratory Fee', amount: 5000, frequency: 'ANNUAL', status: 'active' },

    // B.Sc Chemistry 2nd Year (2026-27)
    { feeId: 'FEE-0004', course: 'B.Sc Chemistry', level: 'UG', year: '2nd Year', academicYear: '2026-27', category: 'Tuition Fee', amount: 35000, frequency: 'ANNUAL', status: 'active' },
    { feeId: 'FEE-0005', course: 'B.Sc Chemistry', level: 'UG', year: '2nd Year', academicYear: '2026-27', category: 'Laboratory Fee', amount: 5000, frequency: 'ANNUAL', status: 'active' },

    // M.Sc Organic Chemistry 1st Year (2025-26)
    { feeId: 'FEE-0006', course: 'M.Sc Organic Chemistry', level: 'PG', year: '1st Year', academicYear: '2025-26', category: 'Tuition Fee', amount: 40000, frequency: 'ANNUAL', status: 'active' },
    { feeId: 'FEE-0007', course: 'M.Sc Organic Chemistry', level: 'PG', year: '1st Year', academicYear: '2025-26', category: 'Admission Fee', amount: 5000, frequency: 'ONE_TIME', status: 'active' },
    { feeId: 'FEE-0008', course: 'M.Sc Organic Chemistry', level: 'PG', year: '1st Year', academicYear: '2025-26', category: 'Laboratory Fee', amount: 10000, frequency: 'ANNUAL', status: 'active' },

    // M.Sc Organic Chemistry 2nd Year (2026-27)
    { feeId: 'FEE-0009', course: 'M.Sc Organic Chemistry', level: 'PG', year: '2nd Year', academicYear: '2026-27', category: 'Tuition Fee', amount: 40000, frequency: 'ANNUAL', status: 'active' },
    { feeId: 'FEE-0010', course: 'M.Sc Organic Chemistry', level: 'PG', year: '2nd Year', academicYear: '2026-27', category: 'Laboratory Fee', amount: 10000, frequency: 'ANNUAL', status: 'active' }
  ]);
  console.log('Fee structures created');

  // 4. Update / Create Rahul Sharma (UG - B.Sc Chemistry - 2nd Year Student)
  let rahul = await Student.findOne({ admissionNo: 'UG2025BSC001' });
  if (!rahul) {
    rahul = await Student.create({
      studentId: 'STU-0001',
      admissionNo: 'UG2025BSC001',
      name: 'Rahul Sharma',
      degree: 'B.Sc',
      specialization: 'Chemistry',
      course: 'B.Sc Chemistry',
      courseId: bscCourse ? bscCourse._id : undefined,
      duration: 3,
      level: 'UG',
      currentYear: '2nd Year',
      currentAcademicYear: '2026-27',
      batch: '2025–2028',
      batchStartYear: 2025,
      batchEndYear: 2028,
      email: 'rahul.sharma@example.com',
      phone: '9876543210',
      fatherName: 'Ramesh Sharma',
      gender: 'Male',
      address: '123 MG Road, Hyderabad',
      enrollmentHistory: [
        { year: '1st Year', academicYear: '2025-26', promotedAt: new Date('2025-06-15') },
        { year: '2nd Year', academicYear: '2026-27', promotedAt: new Date('2026-06-10') }
      ]
    });
  } else {
    rahul.currentYear = '2nd Year';
    rahul.currentAcademicYear = '2026-27';
    rahul.batch = '2025–2028';
    rahul.duration = 3;
    rahul.enrollmentHistory = [
      { year: '1st Year', academicYear: '2025-26', promotedAt: new Date('2025-06-15') },
      { year: '2nd Year', academicYear: '2026-27', promotedAt: new Date('2026-06-10') }
    ];
    await rahul.save();
  }

  // 5. Update / Create Priya Patel (PG - M.Sc Organic Chemistry - 2nd Year Student)
  let priya = await Student.findOne({ admissionNo: 'PG2025MSC001' });
  if (!priya) {
    priya = await Student.create({
      studentId: 'STU-0002',
      admissionNo: 'PG2025MSC001',
      name: 'Priya Patel',
      degree: 'M.Sc',
      specialization: 'Organic Chemistry',
      course: 'M.Sc Organic Chemistry',
      courseId: mscCourse ? mscCourse._id : undefined,
      duration: 2,
      level: 'PG',
      currentYear: '2nd Year',
      currentAcademicYear: '2026-27',
      batch: '2025–2027',
      batchStartYear: 2025,
      batchEndYear: 2027,
      email: 'priya.patel@example.com',
      phone: '9876543211',
      fatherName: 'Mahesh Patel',
      gender: 'Female',
      address: '456 Jubilee Hills, Hyderabad',
      enrollmentHistory: [
        { year: '1st Year', academicYear: '2025-26', promotedAt: new Date('2025-07-01') },
        { year: '2nd Year', academicYear: '2026-27', promotedAt: new Date('2026-06-12') }
      ]
    });
  } else {
    priya.currentYear = '2nd Year';
    priya.currentAcademicYear = '2026-27';
    priya.batch = '2025–2027';
    priya.duration = 2;
    priya.enrollmentHistory = [
      { year: '1st Year', academicYear: '2025-26', promotedAt: new Date('2025-07-01') },
      { year: '2nd Year', academicYear: '2026-27', promotedAt: new Date('2026-06-12') }
    ];
    await priya.save();
  }

  // 6. Create Fee Demands with timestamps matching the beginning of each academic year
  // Rahul: 1st Year (2025-26)
  await FeeDemand.collection.insertOne({
    student: rahul._id,
    studentId: rahul.studentId,
    academicYear: '2025-26',
    year: '1st Year',
    course: rahul.course,
    level: rahul.level,
    categories: [
      { category: 'Tuition Fee', amount: 35000, frequency: 'ANNUAL', status: 'active' },
      { category: 'Admission Fee', amount: 5000, frequency: 'ONE_TIME', status: 'active' },
      { category: 'Laboratory Fee', amount: 5000, frequency: 'ANNUAL', status: 'active' }
    ],
    totalDemand: 45000,
    status: 'active',
    createdBy: adminId,
    createdAt: new Date('2025-06-01T09:00:00Z'),
    updatedAt: new Date('2025-06-01T09:00:00Z')
  });

  // Rahul: 2nd Year (2026-27)
  await FeeDemand.collection.insertOne({
    student: rahul._id,
    studentId: rahul.studentId,
    academicYear: '2026-27',
    year: '2nd Year',
    course: rahul.course,
    level: rahul.level,
    categories: [
      { category: 'Tuition Fee', amount: 35000, frequency: 'ANNUAL', status: 'active' },
      { category: 'Laboratory Fee', amount: 5000, frequency: 'ANNUAL', status: 'active' }
    ],
    totalDemand: 40000,
    status: 'active',
    createdBy: adminId,
    createdAt: new Date('2026-06-01T09:00:00Z'),
    updatedAt: new Date('2026-06-01T09:00:00Z')
  });

  // Priya: 1st Year (2025-26)
  await FeeDemand.collection.insertOne({
    student: priya._id,
    studentId: priya.studentId,
    academicYear: '2025-26',
    year: '1st Year',
    course: priya.course,
    level: priya.level,
    categories: [
      { category: 'Tuition Fee', amount: 40000, frequency: 'ANNUAL', status: 'active' },
      { category: 'Admission Fee', amount: 5000, frequency: 'ONE_TIME', status: 'active' },
      { category: 'Laboratory Fee', amount: 10000, frequency: 'ANNUAL', status: 'active' }
    ],
    totalDemand: 55000,
    status: 'active',
    createdBy: adminId,
    createdAt: new Date('2025-06-01T09:00:00Z'),
    updatedAt: new Date('2025-06-01T09:00:00Z')
  });

  // Priya: 2nd Year (2026-27)
  await FeeDemand.collection.insertOne({
    student: priya._id,
    studentId: priya.studentId,
    academicYear: '2026-27',
    year: '2nd Year',
    course: priya.course,
    level: priya.level,
    categories: [
      { category: 'Tuition Fee', amount: 40000, frequency: 'ANNUAL', status: 'active' },
      { category: 'Laboratory Fee', amount: 10000, frequency: 'ANNUAL', status: 'active' }
    ],
    totalDemand: 50000,
    status: 'active',
    createdBy: adminId,
    createdAt: new Date('2026-06-01T09:00:00Z'),
    updatedAt: new Date('2026-06-01T09:00:00Z')
  });
  console.log('Fee demands created with academic year start dates');

  // 7. Create Payment History
  // Rahul: Year 1 Payments (Paid ₹35,000 out of ₹45,000 => Due: ₹10,000)
  await Payment.create({
    receiptNo: 'REC-2025-00001',
    student: rahul._id,
    studentId: rahul.studentId,
    academicYear: '2025-26',
    year: '1st Year',
    amountPaid: 20000,
    paymentDate: new Date('2025-08-05T10:30:00Z'),
    paymentMode: 'Cash',
    transactionId: 'CASH-REF-001',
    remarks: '1st Year Term 1 Fee',
    enteredBy: adminId,
    enteredByName: adminName,
    allocations: [
      { academicYear: '2025-26', year: '1st Year', category: 'Admission Fee', amount: 5000 },
      { academicYear: '2025-26', year: '1st Year', category: 'Tuition Fee', amount: 15000 }
    ],
    status: 'completed'
  });

  await Payment.create({
    receiptNo: 'REC-2025-00002',
    student: rahul._id,
    studentId: rahul.studentId,
    academicYear: '2025-26',
    year: '1st Year',
    amountPaid: 15000,
    paymentDate: new Date('2025-12-20T14:15:00Z'),
    paymentMode: 'UPI',
    transactionId: 'UPI/532910482910/HDFC',
    remarks: '1st Year Term 2 Fee',
    enteredBy: adminId,
    enteredByName: adminName,
    allocations: [
      { academicYear: '2025-26', year: '1st Year', category: 'Laboratory Fee', amount: 5000 },
      { academicYear: '2025-26', year: '1st Year', category: 'Tuition Fee', amount: 10000 }
    ],
    status: 'completed'
  });

  // Rahul: Year 2 Payment (Paid ₹15,000 out of ₹50,000 total payable => Remaining Due: ₹35,000)
  await Payment.create({
    receiptNo: 'REC-2026-00001',
    student: rahul._id,
    studentId: rahul.studentId,
    academicYear: '2026-27',
    year: '2nd Year',
    amountPaid: 15000,
    paymentDate: new Date('2026-07-18T11:00:00Z'),
    paymentMode: 'Card',
    transactionId: 'POS-TXN-984210',
    remarks: '2nd Year Installment 1',
    enteredBy: adminId,
    enteredByName: adminName,
    allocations: [
      { academicYear: '2026-27', year: '2nd Year', category: 'Tuition Fee', amount: 15000 }
    ],
    status: 'completed'
  });

  // Priya: Year 1 Payments (Paid ₹40,000 out of ₹55,000 => Due: ₹15,000)
  await Payment.create({
    receiptNo: 'REC-2025-00003',
    student: priya._id,
    studentId: priya.studentId,
    academicYear: '2025-26',
    year: '1st Year',
    amountPaid: 25000,
    paymentDate: new Date('2025-07-12T09:45:00Z'),
    paymentMode: 'Bank Transfer',
    transactionId: 'NEFT-SBIN250712984',
    remarks: '1st Year Initial Admission Fee',
    enteredBy: adminId,
    enteredByName: adminName,
    allocations: [
      { academicYear: '2025-26', year: '1st Year', category: 'Admission Fee', amount: 5000 },
      { academicYear: '2025-26', year: '1st Year', category: 'Tuition Fee', amount: 20000 }
    ],
    status: 'completed'
  });

  await Payment.create({
    receiptNo: 'REC-2025-00004',
    student: priya._id,
    studentId: priya.studentId,
    academicYear: '2025-26',
    year: '1st Year',
    amountPaid: 15000,
    paymentDate: new Date('2025-11-10T16:20:00Z'),
    paymentMode: 'UPI',
    transactionId: 'UPI/582910294819/ICICI',
    remarks: '1st Year Lab & Term 2 Fee',
    enteredBy: adminId,
    enteredByName: adminName,
    allocations: [
      { academicYear: '2025-26', year: '1st Year', category: 'Laboratory Fee', amount: 10000 },
      { academicYear: '2025-26', year: '1st Year', category: 'Tuition Fee', amount: 5000 }
    ],
    status: 'completed'
  });

  // Priya: Year 2 Payment (Paid ₹20,000 out of ₹65,000 total payable => Remaining Due: ₹45,000)
  await Payment.create({
    receiptNo: 'REC-2026-00002',
    student: priya._id,
    studentId: priya.studentId,
    academicYear: '2026-27',
    year: '2nd Year',
    amountPaid: 20000,
    paymentDate: new Date('2026-07-15T10:10:00Z'),
    paymentMode: 'UPI',
    transactionId: 'UPI/682910482910/SBI',
    remarks: '2nd Year Installment 1',
    enteredBy: adminId,
    enteredByName: adminName,
    allocations: [
      { academicYear: '2026-27', year: '2nd Year', category: 'Tuition Fee', amount: 20000 }
    ],
    status: 'completed'
  });

  console.log('Payments created successfully');

  // Verify summaries
  const s1 = await calculateFeeSummary(rahul.studentId);
  const s2 = await calculateFeeSummary(priya.studentId);
  console.log('Rahul (UG) Total Fee:', s1.overall.totalFee, 'Paid:', s1.overall.totalPaid, 'Pending:', s1.overall.totalPending);
  console.log('Priya (PG) Total Fee:', s2.overall.totalFee, 'Paid:', s2.overall.totalPaid, 'Pending:', s2.overall.totalPending);

  const l2 = await generateFeeLedger(priya.studentId);
  console.log('\nPriya Ledger Entries:');
  l2.entries.forEach(e => {
    console.log(`  ${e.date.toISOString().split('T')[0]} | ${e.description} | Debit: ₹${e.debit} | Credit: ₹${e.credit} | Balance: ₹${e.balance}`);
  });

  process.exit(0);
}

seedHistory().catch(e => {
  console.error(e);
  process.exit(1);
});

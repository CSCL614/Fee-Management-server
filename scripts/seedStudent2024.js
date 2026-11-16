const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Student = require('../models/Student');
const Course = require('../models/Course');
const FeeStructure = require('../models/FeeStructure');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { calculateFeeSummary, generateFeeLedger } = require('../utils/feeCalculator');
const { generateId } = require('../utils/helpers');

async function seedStudent2024() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB:', process.env.MONGODB_URI);

    const admin = await User.findOne({ role: 'admin' });
    const adminId = admin ? admin._id : new mongoose.Types.ObjectId();
    const adminName = admin ? admin.name : 'Dr. Ramesh Kumar';

    // 1. Ensure B.Sc Computer Science course exists
    let bscCs = await Course.findOne({ degree: 'B.Sc', specialization: 'Computer Science' });
    if (!bscCs) {
      const courseId = await generateId(Course, 'CRS', 'courseId');
      bscCs = await Course.create({
        courseId,
        degree: 'B.Sc',
        specialization: 'Computer Science',
        courseName: 'B.Sc Computer Science',
        duration: 3,
        level: 'UG',
        status: 'active'
      });
      console.log('Created Course: B.Sc Computer Science');
    }

    // 2. Ensure Fee Structures exist for all 3 years of the 2024-27 batch
    // Year 1 (2024-25), Year 2 (2025-26), Year 3 (2026-27)
    const academicYearsData = [
      {
        year: '1st Year',
        academicYear: '2024-25',
        startYear: 2024,
        nextYear: 2025,
        terms: [
          { category: 'Tuition Fee', amount: 30000, frequency: 'ANNUAL', semester: null },
          { category: 'Admission Fee', amount: 2000, frequency: 'ONE_TIME', semester: null },
          { category: 'UDF Fee', amount: 1000, frequency: 'ANNUAL', semester: null },
          { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 1' },
          { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 2' },
          { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 1' },
          { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 2' }
        ]
      },
      {
        year: '2nd Year',
        academicYear: '2025-26',
        startYear: 2025,
        nextYear: 2026,
        terms: [
          { category: 'Tuition Fee', amount: 30000, frequency: 'ANNUAL', semester: null },
          { category: 'UDF Fee', amount: 1000, frequency: 'ANNUAL', semester: null },
          { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 1' },
          { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 2' },
          { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 1' },
          { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 2' }
        ]
      },
      {
        year: '3rd Year',
        academicYear: '2026-27',
        startYear: 2026,
        nextYear: 2027,
        terms: [
          { category: 'Tuition Fee', amount: 30000, frequency: 'ANNUAL', semester: null },
          { category: 'UDF Fee', amount: 1000, frequency: 'ANNUAL', semester: null },
          { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 1' },
          { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 2' },
          { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 1' },
          { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 2' }
        ]
      }
    ];

    for (const ayGroup of academicYearsData) {
      for (const t of ayGroup.terms) {
        const query = {
          course: 'B.Sc Computer Science',
          year: ayGroup.year,
          academicYear: ayGroup.academicYear,
          category: t.category,
          semester: t.semester,
          status: 'active'
        };

        const existing = await FeeStructure.findOne(query);
        if (!existing) {
          const feeId = await generateId(FeeStructure, 'FEE', 'feeId');
          await FeeStructure.create({
            feeId,
            course: 'B.Sc Computer Science',
            level: 'UG',
            year: ayGroup.year,
            academicYear: ayGroup.academicYear,
            category: t.category,
            amount: t.amount,
            frequency: t.frequency,
            semester: t.semester,
            activationDate: t.semester === 'Semester 2' ? new Date(`${ayGroup.nextYear}-03-01`) : (t.semester === 'Semester 1' ? new Date(`${ayGroup.startYear}-10-01`) : new Date(`${ayGroup.startYear}-06-01`)),
            dueDate: t.semester === 'Semester 2' ? new Date(`${ayGroup.nextYear}-03-31`) : (t.semester === 'Semester 1' ? new Date(`${ayGroup.startYear}-10-31`) : new Date(`${ayGroup.startYear}-07-31`)),
            status: 'active',
            remarks: `Fee Structure for ${ayGroup.year} (${ayGroup.academicYear})`
          });
          console.log(`Created FeeStructure: ${ayGroup.year} (${ayGroup.academicYear}) - ${t.category} [${t.semester || 'Annual'}]`);
        }
      }
    }

    // 3. Create or Update Student joined in 2024
    const admissionNo = 'BSC2024051';
    let student = await Student.findOne({ admissionNo });

    if (!student) {
      const studentId = await generateId(Student, 'STU', 'studentId');
      student = await Student.create({
        studentId,
        admissionNo,
        name: 'Aditya Verma',
        degree: 'B.Sc',
        specialization: 'Computer Science',
        courseId: bscCs._id,
        duration: 3,
        course: 'B.Sc Computer Science',
        level: 'UG',
        currentYear: '3rd Year',
        currentAcademicYear: '2026-27',
        batchStartYear: 2024,
        batchEndYear: 2027,
        batch: '2024–2027',
        enrollmentHistory: [
          { year: '1st Year', academicYear: '2024-25', promotedAt: new Date('2024-06-15T09:00:00Z') },
          { year: '2nd Year', academicYear: '2025-26', promotedAt: new Date('2025-06-10T09:00:00Z') },
          { year: '3rd Year', academicYear: '2026-27', promotedAt: new Date('2026-06-05T09:00:00Z') }
        ],
        email: 'aditya.verma@example.com',
        phone: '9876543220',
        fatherName: 'Suresh Verma',
        gender: 'Male',
        address: 'Plot 42, Cyber Hills, Madhapur, Hyderabad, Telangana',
        status: 'Active',
        advanceCredit: 0
      });
      console.log(`Created Student: ${student.name} (${student.admissionNo}, ${student.studentId})`);
    } else {
      console.log(`Student already exists: ${student.name} (${student.admissionNo}, ${student.studentId})`);
    }

    // 4. Create Fee Demands for all 3 Years
    // Demand 1: 1st Year (2024-25)
    let demandY1 = await FeeDemand.findOne({ student: student._id, academicYear: '2024-25' });
    if (!demandY1) {
      const categoriesY1 = [
        { category: 'Tuition Fee', amount: 30000, frequency: 'ANNUAL', semester: null, activationDate: new Date('2024-06-01'), dueDate: new Date('2024-07-31'), status: 'active' },
        { category: 'Admission Fee', amount: 2000, frequency: 'ONE_TIME', semester: null, activationDate: new Date('2024-06-01'), dueDate: new Date('2024-07-31'), status: 'active' },
        { category: 'UDF Fee', amount: 1000, frequency: 'ANNUAL', semester: null, activationDate: new Date('2024-06-01'), dueDate: new Date('2024-07-31'), status: 'active' },
        { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 1', activationDate: new Date('2024-10-01'), dueDate: new Date('2024-10-31'), status: 'active' },
        { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 2', activationDate: new Date('2025-03-01'), dueDate: new Date('2025-03-31'), status: 'active' },
        { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 1', activationDate: new Date('2024-10-01'), dueDate: new Date('2024-10-31'), status: 'active' },
        { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 2', activationDate: new Date('2025-03-01'), dueDate: new Date('2025-03-31'), status: 'active' }
      ];
      demandY1 = await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear: '2024-25',
        year: '1st Year',
        course: student.course,
        level: student.level,
        categories: categoriesY1,
        totalDemand: 39000,
        status: 'active',
        createdBy: adminId,
        createdAt: new Date('2024-06-01T09:00:00Z'),
        updatedAt: new Date('2024-06-01T09:00:00Z')
      });
      console.log('Created FeeDemand: 1st Year (2024-25) - Total ₹39,000');
    }

    // Demand 2: 2nd Year (2025-26)
    let demandY2 = await FeeDemand.findOne({ student: student._id, academicYear: '2025-26' });
    if (!demandY2) {
      const categoriesY2 = [
        { category: 'Tuition Fee', amount: 30000, frequency: 'ANNUAL', semester: null, activationDate: new Date('2025-06-01'), dueDate: new Date('2025-07-31'), status: 'active' },
        { category: 'UDF Fee', amount: 1000, frequency: 'ANNUAL', semester: null, activationDate: new Date('2025-06-01'), dueDate: new Date('2025-07-31'), status: 'active' },
        { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 1', activationDate: new Date('2025-10-01'), dueDate: new Date('2025-10-31'), status: 'active' },
        { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 2', activationDate: new Date('2026-03-01'), dueDate: new Date('2026-03-31'), status: 'active' },
        { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 1', activationDate: new Date('2025-10-01'), dueDate: new Date('2025-10-31'), status: 'active' },
        { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 2', activationDate: new Date('2026-03-01'), dueDate: new Date('2026-03-31'), status: 'active' }
      ];
      demandY2 = await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear: '2025-26',
        year: '2nd Year',
        course: student.course,
        level: student.level,
        categories: categoriesY2,
        totalDemand: 37000,
        status: 'active',
        createdBy: adminId,
        createdAt: new Date('2025-06-01T09:00:00Z'),
        updatedAt: new Date('2025-06-01T09:00:00Z')
      });
      console.log('Created FeeDemand: 2nd Year (2025-26) - Total ₹37,000');
    }

    // Demand 3: 3rd Year (2026-27)
    let demandY3 = await FeeDemand.findOne({ student: student._id, academicYear: '2026-27' });
    if (!demandY3) {
      const categoriesY3 = [
        { category: 'Tuition Fee', amount: 30000, frequency: 'ANNUAL', semester: null, activationDate: new Date('2026-06-01'), dueDate: new Date('2026-07-31'), status: 'active' },
        { category: 'UDF Fee', amount: 1000, frequency: 'ANNUAL', semester: null, activationDate: new Date('2026-06-01'), dueDate: new Date('2026-07-31'), status: 'active' },
        { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 1', activationDate: new Date('2026-10-01'), dueDate: new Date('2026-10-31'), status: 'active' },
        { category: 'Exam Fee', amount: 1000, frequency: 'SEMESTER', semester: 'Semester 2', activationDate: new Date('2027-03-01'), dueDate: new Date('2027-03-31'), status: 'active' },
        { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 1', activationDate: new Date('2026-10-01'), dueDate: new Date('2026-10-31'), status: 'active' },
        { category: 'Practical Fee', amount: 2000, frequency: 'SEMESTER', semester: 'Semester 2', activationDate: new Date('2027-03-01'), dueDate: new Date('2027-03-31'), status: 'active' }
      ];
      demandY3 = await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear: '2026-27',
        year: '3rd Year',
        course: student.course,
        level: student.level,
        categories: categoriesY3,
        totalDemand: 37000,
        status: 'active',
        createdBy: adminId,
        createdAt: new Date('2026-06-01T09:00:00Z'),
        updatedAt: new Date('2026-06-01T09:00:00Z')
      });
      console.log('Created FeeDemand: 3rd Year (2026-27) - Total ₹37,000');
    }

    // 5. Add Payment History
    // Check if payments already exist for this student
    const existingPayments = await Payment.find({ studentId: student.studentId });
    if (existingPayments.length === 0) {
      // 1st Year Payments (Total ₹30,000 paid out of ₹39,000 => Unpaid ₹9,000)
      await Payment.create({
        receiptNo: 'REC-2024-00001',
        student: student._id,
        studentId: student.studentId,
        academicYear: '2024-25',
        year: '1st Year',
        amountPaid: 20000,
        paymentDate: new Date('2024-07-15T10:30:00Z'),
        paymentMode: 'UPI',
        transactionId: 'UPI/419610284910/SBI',
        remarks: '1st Year Admission & Term 1 Tuition Fee',
        enteredBy: adminId,
        enteredByName: adminName,
        allocations: [
          { academicYear: '2024-25', year: '1st Year', category: 'Admission Fee', amount: 2000 },
          { academicYear: '2024-25', year: '1st Year', category: 'Tuition Fee', amount: 18000 }
        ],
        status: 'completed'
      });

      await Payment.create({
        receiptNo: 'REC-2024-00002',
        student: student._id,
        studentId: student.studentId,
        academicYear: '2024-25',
        year: '1st Year',
        amountPaid: 10000,
        paymentDate: new Date('2024-11-20T14:15:00Z'),
        paymentMode: 'Bank Transfer',
        transactionId: 'NEFT-HDFC241120984',
        remarks: '1st Year Term 2 Tuition, Labs & Exam Fee (Partial)',
        enteredBy: adminId,
        enteredByName: adminName,
        allocations: [
          { academicYear: '2024-25', year: '1st Year', category: 'Tuition Fee', amount: 3000 },
          { academicYear: '2024-25', year: '1st Year', category: 'UDF Fee', amount: 1000 },
          { academicYear: '2024-25', year: '1st Year', category: 'Exam Fee', semester: 'Semester 1', amount: 1000 },
          { academicYear: '2024-25', year: '1st Year', category: 'Exam Fee', semester: 'Semester 2', amount: 1000 },
          { academicYear: '2024-25', year: '1st Year', category: 'Practical Fee', semester: 'Semester 1', amount: 2000 },
          { academicYear: '2024-25', year: '1st Year', category: 'Practical Fee', semester: 'Semester 2', amount: 2000 }
        ],
        status: 'completed'
      });

      // 2nd Year Payments (Total ₹32,000 paid out of ₹37,000 demand + ₹9,000 carry forward => Cumulative Due ₹14,000)
      await Payment.create({
        receiptNo: 'REC-2025-00001',
        student: student._id,
        studentId: student.studentId,
        academicYear: '2025-26',
        year: '2nd Year',
        amountPaid: 20000,
        paymentDate: new Date('2025-07-12T11:00:00Z'),
        paymentMode: 'Card',
        transactionId: 'POS-TXN-829104',
        remarks: '2nd Year Term 1 Tuition Fee',
        enteredBy: adminId,
        enteredByName: adminName,
        allocations: [
          { academicYear: '2025-26', year: '2nd Year', category: 'Tuition Fee', amount: 20000 }
        ],
        status: 'completed'
      });

      await Payment.create({
        receiptNo: 'REC-2025-00002',
        student: student._id,
        studentId: student.studentId,
        academicYear: '2025-26',
        year: '2nd Year',
        amountPaid: 12000,
        paymentDate: new Date('2025-11-18T16:00:00Z'),
        paymentMode: 'UPI',
        transactionId: 'UPI/532291029481/ICICI',
        remarks: '2nd Year Term 2 Tuition, Labs & Exam Fee (Partial)',
        enteredBy: adminId,
        enteredByName: adminName,
        allocations: [
          { academicYear: '2025-26', year: '2nd Year', category: 'Tuition Fee', amount: 5000 },
          { academicYear: '2025-26', year: '2nd Year', category: 'UDF Fee', amount: 1000 },
          { academicYear: '2025-26', year: '2nd Year', category: 'Exam Fee', semester: 'Semester 1', amount: 1000 },
          { academicYear: '2025-26', year: '2nd Year', category: 'Exam Fee', semester: 'Semester 2', amount: 1000 },
          { academicYear: '2025-26', year: '2nd Year', category: 'Practical Fee', semester: 'Semester 1', amount: 2000 },
          { academicYear: '2025-26', year: '2nd Year', category: 'Practical Fee', semester: 'Semester 2', amount: 2000 }
        ],
        status: 'completed'
      });

      // 3rd Year Payment (₹20,000 paid, ₹17,000 pending)
      await Payment.create({
        receiptNo: 'REC-2026-00010',
        student: student._id,
        studentId: student.studentId,
        academicYear: '2026-27',
        year: '3rd Year',
        amountPaid: 20000,
        paymentDate: new Date('2026-07-20T10:45:00Z'),
        paymentMode: 'UPI',
        transactionId: 'UPI/620291029384/AXIS',
        remarks: '3rd Year Term 1 Tuition Fee Installment',
        enteredBy: adminId,
        enteredByName: adminName,
        allocations: [
          { academicYear: '2026-27', year: '3rd Year', category: 'Tuition Fee', amount: 20000 }
        ],
        status: 'completed'
      });
      console.log('Created 5 payment receipts across 3 academic years');
    }

    // 6. Verify Fee Summary & Ledger
    const summary = await calculateFeeSummary(student.studentId);
    console.log('\n================ FEE SUMMARY ================');
    console.log('Student:', student.name, `(${student.studentId})`);
    console.log('Overall Total Fee:', summary.overall.totalFee);
    console.log('Overall Total Paid:', summary.overall.totalPaid);
    console.log('Overall Total Pending:', summary.overall.totalPending);
    console.log('Overall Status:', summary.overall.status);

    console.log('\nYear-wise Breakdowns:');
    (summary.yearSummaries || []).forEach(y => {
      console.log(`- ${y.year} (${y.academicYear}): Payable ₹${y.totalPayable}, Paid ₹${y.totalPaid}, Pending ₹${y.pending}, Status: ${y.status}`);
    });

    const ledger = await generateFeeLedger(student.studentId);
    console.log('\nLedger Transactions:', ledger.entries.length, 'entries');

    await mongoose.disconnect();
    console.log('\nDone! Disconnected from MongoDB.');
  } catch (err) {
    console.error('Error seeding student 2024:', err);
    process.exit(1);
  }
}

seedStudent2024();

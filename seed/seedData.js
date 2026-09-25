require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Student = require('../models/Student');
const FeeCategory = require('../models/FeeCategory');
const FeeStructure = require('../models/FeeStructure');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const AcademicYear = require('../models/AcademicYear');
const AuditLog = require('../models/AuditLog');
const Setting = require('../models/Setting');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear all collections
    await Promise.all([
      User.deleteMany({}), Student.deleteMany({}), FeeCategory.deleteMany({}),
      FeeStructure.deleteMany({}), FeeDemand.deleteMany({}), Payment.deleteMany({}),
      AcademicYear.deleteMany({}), AuditLog.deleteMany({}), Setting.deleteMany({})
    ]);
    console.log('Cleared all collections');

    // ==================== SETTINGS ====================
    await Setting.insertMany([
      { key: 'collegeName', value: 'Sri Vidya Degree College' },
      { key: 'collegeAddress', value: 'Kukatpally, Hyderabad, Telangana - 500072' },
      { key: 'collegePhone', value: '040-23456789' },
      { key: 'collegeEmail', value: 'info@srividya.edu.in' },
      { key: 'allowAdvancePayment', value: false },
      { key: 'emailEnabled', value: false }
    ]);

    // ==================== ACADEMIC YEARS ====================
    const academicYears = await AcademicYear.insertMany([
      { year: '2024-25', startDate: new Date('2024-06-01'), endDate: new Date('2025-05-31'), isCurrent: false, status: 'active' },
      { year: '2025-26', startDate: new Date('2025-06-01'), endDate: new Date('2026-05-31'), isCurrent: false, status: 'active' },
      { year: '2026-27', startDate: new Date('2026-06-01'), endDate: new Date('2027-05-31'), isCurrent: true, status: 'active' }
    ]);
    console.log('Created academic years');

    // ==================== USERS ====================
    const salt = await bcrypt.genSalt(12);
    const users = await User.insertMany([
      { userId: 'USR-0001', name: 'Dr. Ramesh Kumar', username: 'admin', password: await bcrypt.hash('admin123', salt), role: 'admin', status: 'active' },
      { userId: 'USR-0002', name: 'Suresh Reddy', username: 'suresh', password: await bcrypt.hash('acc123', salt), role: 'accountant', status: 'active' },
      { userId: 'USR-0003', name: 'Priya Sharma', username: 'priya', password: await bcrypt.hash('acc123', salt), role: 'accountant', status: 'active' }
    ]);
    console.log('Created users');

    // ==================== FEE CATEGORIES ====================
    const categories = await FeeCategory.insertMany([
      { name: 'Tuition Fee', description: 'Annual tuition fee', isDefault: true, status: 'active' },
      { name: 'Admission Fee', description: 'One-time admission fee', isDefault: true, status: 'active' },
      { name: 'Examination Fee', description: 'Semester examination fee', isDefault: true, status: 'active' },
      { name: 'University Fee', description: 'University registration fee', isDefault: true, status: 'active' },
      { name: 'Laboratory Fee', description: 'Lab usage fee', isDefault: true, status: 'active' },
      { name: 'Library Fee', description: 'Library access fee', isDefault: true, status: 'active' },
      { name: 'Hostel Fee', description: 'Hostel accommodation fee', isDefault: false, status: 'active' },
      { name: 'Transport Fee', description: 'College transport fee', isDefault: false, status: 'active' },
      { name: 'Other Fee', description: 'Miscellaneous fees', isDefault: false, status: 'active' }
    ]);
    console.log('Created fee categories');

    // ==================== FEE STRUCTURES ====================
    const feeData = [
      // BCA - UG
      { course: 'BCA', level: 'UG', year: '1st Year', academicYear: '2024-25', fees: [['Tuition Fee', 35000], ['Admission Fee', 5000], ['Examination Fee', 3000], ['University Fee', 2000], ['Laboratory Fee', 3000], ['Library Fee', 2000]] },
      { course: 'BCA', level: 'UG', year: '2nd Year', academicYear: '2025-26', fees: [['Tuition Fee', 38000], ['Examination Fee', 3000], ['University Fee', 2000], ['Laboratory Fee', 3000], ['Library Fee', 2000]] },
      { course: 'BCA', level: 'UG', year: '3rd Year', academicYear: '2026-27', fees: [['Tuition Fee', 40000], ['Examination Fee', 3500], ['University Fee', 2500], ['Laboratory Fee', 3000], ['Library Fee', 2000]] },
      // BBA - UG
      { course: 'BBA', level: 'UG', year: '1st Year', academicYear: '2024-25', fees: [['Tuition Fee', 30000], ['Admission Fee', 5000], ['Examination Fee', 2500], ['University Fee', 2000], ['Library Fee', 1500]] },
      { course: 'BBA', level: 'UG', year: '2nd Year', academicYear: '2025-26', fees: [['Tuition Fee', 32000], ['Examination Fee', 2500], ['University Fee', 2000], ['Library Fee', 1500]] },
      { course: 'BBA', level: 'UG', year: '3rd Year', academicYear: '2026-27', fees: [['Tuition Fee', 35000], ['Examination Fee', 3000], ['University Fee', 2500], ['Library Fee', 1500]] },
      // BSc - UG
      { course: 'BSc', level: 'UG', year: '1st Year', academicYear: '2024-25', fees: [['Tuition Fee', 25000], ['Admission Fee', 4000], ['Examination Fee', 2000], ['University Fee', 1500], ['Laboratory Fee', 5000], ['Library Fee', 1500]] },
      { course: 'BSc', level: 'UG', year: '2nd Year', academicYear: '2025-26', fees: [['Tuition Fee', 27000], ['Examination Fee', 2000], ['University Fee', 1500], ['Laboratory Fee', 5000], ['Library Fee', 1500]] },
      { course: 'BSc', level: 'UG', year: '3rd Year', academicYear: '2026-27', fees: [['Tuition Fee', 30000], ['Examination Fee', 2500], ['University Fee', 2000], ['Laboratory Fee', 5000], ['Library Fee', 1500]] },
      // Also create BCA/BBA/BSc fee structures for 2025-26 1st year and 2026-27 1st/2nd year for newer students
      { course: 'BCA', level: 'UG', year: '1st Year', academicYear: '2025-26', fees: [['Tuition Fee', 37000], ['Admission Fee', 5000], ['Examination Fee', 3000], ['University Fee', 2000], ['Laboratory Fee', 3000], ['Library Fee', 2000]] },
      { course: 'BCA', level: 'UG', year: '1st Year', academicYear: '2026-27', fees: [['Tuition Fee', 40000], ['Admission Fee', 5500], ['Examination Fee', 3500], ['University Fee', 2500], ['Laboratory Fee', 3000], ['Library Fee', 2000]] },
      { course: 'BCA', level: 'UG', year: '2nd Year', academicYear: '2026-27', fees: [['Tuition Fee', 40000], ['Examination Fee', 3500], ['University Fee', 2500], ['Laboratory Fee', 3000], ['Library Fee', 2000]] },
      { course: 'BBA', level: 'UG', year: '1st Year', academicYear: '2025-26', fees: [['Tuition Fee', 32000], ['Admission Fee', 5000], ['Examination Fee', 2500], ['University Fee', 2000], ['Library Fee', 1500]] },
      { course: 'BBA', level: 'UG', year: '1st Year', academicYear: '2026-27', fees: [['Tuition Fee', 35000], ['Admission Fee', 5500], ['Examination Fee', 3000], ['University Fee', 2500], ['Library Fee', 1500]] },
      { course: 'BBA', level: 'UG', year: '2nd Year', academicYear: '2026-27', fees: [['Tuition Fee', 35000], ['Examination Fee', 3000], ['University Fee', 2500], ['Library Fee', 1500]] },
      // MBA - PG
      { course: 'MBA', level: 'PG', year: '1st Year', academicYear: '2025-26', fees: [['Tuition Fee', 60000], ['Admission Fee', 10000], ['Examination Fee', 5000], ['University Fee', 3000], ['Library Fee', 2000]] },
      { course: 'MBA', level: 'PG', year: '2nd Year', academicYear: '2026-27', fees: [['Tuition Fee', 65000], ['Examination Fee', 5000], ['University Fee', 3000], ['Library Fee', 2000]] },
      { course: 'MBA', level: 'PG', year: '1st Year', academicYear: '2026-27', fees: [['Tuition Fee', 65000], ['Admission Fee', 10000], ['Examination Fee', 5000], ['University Fee', 3500], ['Library Fee', 2000]] },
      // MCA - PG
      { course: 'MCA', level: 'PG', year: '1st Year', academicYear: '2025-26', fees: [['Tuition Fee', 55000], ['Admission Fee', 8000], ['Examination Fee', 4000], ['University Fee', 3000], ['Laboratory Fee', 5000], ['Library Fee', 2000]] },
      { course: 'MCA', level: 'PG', year: '2nd Year', academicYear: '2026-27', fees: [['Tuition Fee', 58000], ['Examination Fee', 4000], ['University Fee', 3000], ['Laboratory Fee', 5000], ['Library Fee', 2000]] },
      { course: 'MCA', level: 'PG', year: '1st Year', academicYear: '2026-27', fees: [['Tuition Fee', 58000], ['Admission Fee', 8500], ['Examination Fee', 4500], ['University Fee', 3500], ['Laboratory Fee', 5000], ['Library Fee', 2000]] },
      // MSc - PG
      { course: 'MSc', level: 'PG', year: '1st Year', academicYear: '2025-26', fees: [['Tuition Fee', 40000], ['Admission Fee', 6000], ['Examination Fee', 3000], ['University Fee', 2500], ['Laboratory Fee', 6000], ['Library Fee', 1500]] },
      { course: 'MSc', level: 'PG', year: '2nd Year', academicYear: '2026-27', fees: [['Tuition Fee', 42000], ['Examination Fee', 3000], ['University Fee', 2500], ['Laboratory Fee', 6000], ['Library Fee', 1500]] },
    ];

    let feeCounter = 1;
    const feeStructures = [];
    for (const fd of feeData) {
      for (const [cat, amt] of fd.fees) {
        feeStructures.push({
          feeId: `FEE-${String(feeCounter++).padStart(4, '0')}`,
          course: fd.course, level: fd.level, year: fd.year,
          academicYear: fd.academicYear, category: cat, amount: amt
        });
      }
    }
    await FeeStructure.insertMany(feeStructures);
    console.log(`Created ${feeStructures.length} fee structures`);

    // ==================== STUDENTS ====================
    const studentData = [
      // BCA students - started 2024-25, now in 3rd year
      { id: 'STU-0001', adm: 'UG2024BCA001', name: 'Ravi Kumar', course: 'BCA', level: 'UG', curYear: '3rd Year', curAY: '2026-27', email: 'ravi.kumar@gmail.com', phone: '9876543210', gender: 'Male', father: 'Suresh Kumar', history: [{ y: '1st Year', ay: '2024-25' }, { y: '2nd Year', ay: '2025-26' }, { y: '3rd Year', ay: '2026-27' }] },
      { id: 'STU-0002', adm: 'UG2024BCA002', name: 'Ananya Reddy', course: 'BCA', level: 'UG', curYear: '3rd Year', curAY: '2026-27', email: 'ananya.reddy@gmail.com', phone: '9876543211', gender: 'Female', father: 'Venkat Reddy', history: [{ y: '1st Year', ay: '2024-25' }, { y: '2nd Year', ay: '2025-26' }, { y: '3rd Year', ay: '2026-27' }] },
      { id: 'STU-0003', adm: 'UG2024BCA003', name: 'Karthik Naidu', course: 'BCA', level: 'UG', curYear: '3rd Year', curAY: '2026-27', email: 'karthik.n@gmail.com', phone: '9876543212', gender: 'Male', father: 'Rao Naidu', history: [{ y: '1st Year', ay: '2024-25' }, { y: '2nd Year', ay: '2025-26' }, { y: '3rd Year', ay: '2026-27' }] },
      // BCA students - started 2025-26, now in 2nd year
      { id: 'STU-0004', adm: 'UG2025BCA001', name: 'Deepika Joshi', course: 'BCA', level: 'UG', curYear: '2nd Year', curAY: '2026-27', email: 'deepika.j@gmail.com', phone: '9876543213', gender: 'Female', father: 'Rajesh Joshi', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      { id: 'STU-0005', adm: 'UG2025BCA002', name: 'Arjun Patel', course: 'BCA', level: 'UG', curYear: '2nd Year', curAY: '2026-27', email: 'arjun.p@gmail.com', phone: '9876543214', gender: 'Male', father: 'Mahesh Patel', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      // BCA students - started 2026-27, 1st year
      { id: 'STU-0006', adm: 'UG2026BCA001', name: 'Sneha Gupta', course: 'BCA', level: 'UG', curYear: '1st Year', curAY: '2026-27', email: 'sneha.g@gmail.com', phone: '9876543215', gender: 'Female', father: 'Arun Gupta', history: [{ y: '1st Year', ay: '2026-27' }] },
      // BBA students
      { id: 'STU-0007', adm: 'UG2024BBA001', name: 'Vikram Singh', course: 'BBA', level: 'UG', curYear: '3rd Year', curAY: '2026-27', email: 'vikram.s@gmail.com', phone: '9876543216', gender: 'Male', father: 'Rajpal Singh', history: [{ y: '1st Year', ay: '2024-25' }, { y: '2nd Year', ay: '2025-26' }, { y: '3rd Year', ay: '2026-27' }] },
      { id: 'STU-0008', adm: 'UG2025BBA001', name: 'Pooja Verma', course: 'BBA', level: 'UG', curYear: '2nd Year', curAY: '2026-27', email: 'pooja.v@gmail.com', phone: '9876543217', gender: 'Female', father: 'Sunil Verma', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      { id: 'STU-0009', adm: 'UG2026BBA001', name: 'Rahul Sharma', course: 'BBA', level: 'UG', curYear: '1st Year', curAY: '2026-27', email: 'rahul.s@gmail.com', phone: '9876543218', gender: 'Male', father: 'Dinesh Sharma', history: [{ y: '1st Year', ay: '2026-27' }] },
      // BSc students
      { id: 'STU-0010', adm: 'UG2024BSC001', name: 'Meera Krishnan', course: 'BSc', level: 'UG', curYear: '3rd Year', curAY: '2026-27', email: 'meera.k@gmail.com', phone: '9876543219', gender: 'Female', father: 'K Krishnan', history: [{ y: '1st Year', ay: '2024-25' }, { y: '2nd Year', ay: '2025-26' }, { y: '3rd Year', ay: '2026-27' }] },
      { id: 'STU-0011', adm: 'UG2025BSC001', name: 'Aditya Rao', course: 'BSc', level: 'UG', curYear: '2nd Year', curAY: '2026-27', email: 'aditya.r@gmail.com', phone: '9876543220', gender: 'Male', father: 'Srinivas Rao', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      { id: 'STU-0012', adm: 'UG2026BSC001', name: 'Kavitha Devi', course: 'BSc', level: 'UG', curYear: '1st Year', curAY: '2026-27', email: 'kavitha.d@gmail.com', phone: '9876543221', gender: 'Female', father: 'Ramaiah Devi', history: [{ y: '1st Year', ay: '2026-27' }] },
      // MBA students (PG)
      { id: 'STU-0013', adm: 'PG2025MBA001', name: 'Sanjay Mishra', course: 'MBA', level: 'PG', curYear: '2nd Year', curAY: '2026-27', email: 'sanjay.m@gmail.com', phone: '9876543222', gender: 'Male', father: 'Anil Mishra', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      { id: 'STU-0014', adm: 'PG2025MBA002', name: 'Nandini Iyer', course: 'MBA', level: 'PG', curYear: '2nd Year', curAY: '2026-27', email: 'nandini.i@gmail.com', phone: '9876543223', gender: 'Female', father: 'S Iyer', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      { id: 'STU-0015', adm: 'PG2026MBA001', name: 'Rohit Agarwal', course: 'MBA', level: 'PG', curYear: '1st Year', curAY: '2026-27', email: 'rohit.a@gmail.com', phone: '9876543224', gender: 'Male', father: 'Vijay Agarwal', history: [{ y: '1st Year', ay: '2026-27' }] },
      // MCA students (PG)
      { id: 'STU-0016', adm: 'PG2025MCA001', name: 'Lakshmi Narayan', course: 'MCA', level: 'PG', curYear: '2nd Year', curAY: '2026-27', email: 'lakshmi.n@gmail.com', phone: '9876543225', gender: 'Female', father: 'P Narayan', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      { id: 'STU-0017', adm: 'PG2026MCA001', name: 'Amit Tiwari', course: 'MCA', level: 'PG', curYear: '1st Year', curAY: '2026-27', email: 'amit.t@gmail.com', phone: '9876543226', gender: 'Male', father: 'Ram Tiwari', history: [{ y: '1st Year', ay: '2026-27' }] },
      // MSc students (PG)
      { id: 'STU-0018', adm: 'PG2025MSC001', name: 'Divya Chandra', course: 'MSc', level: 'PG', curYear: '2nd Year', curAY: '2026-27', email: 'divya.c@gmail.com', phone: '9876543227', gender: 'Female', father: 'K Chandra', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
      { id: 'STU-0019', adm: 'PG2026MSC001', name: 'Suresh Babu', course: 'MSc', level: 'PG', curYear: '1st Year', curAY: '2026-27', email: 'suresh.b@gmail.com', phone: '9876543228', gender: 'Male', father: 'G Babu', history: [{ y: '1st Year', ay: '2026-27' }] },
      // Graduated/Discontinued
      { id: 'STU-0020', adm: 'UG2024BBA002', name: 'Preethi Saxena', course: 'BBA', level: 'UG', curYear: '2nd Year', curAY: '2025-26', email: 'preethi.s@gmail.com', phone: '9876543229', gender: 'Female', father: 'R Saxena', status: 'Discontinued', history: [{ y: '1st Year', ay: '2024-25' }, { y: '2nd Year', ay: '2025-26' }] },
      { id: 'STU-0021', adm: 'UG2026BCA002', name: 'Harish Choudhary', course: 'BCA', level: 'UG', curYear: '1st Year', curAY: '2026-27', email: 'harish.c@gmail.com', phone: '9876543230', gender: 'Male', father: 'D Choudhary', history: [{ y: '1st Year', ay: '2026-27' }] },
      { id: 'STU-0022', adm: 'UG2025BCA003', name: 'Swathi Reddy', course: 'BCA', level: 'UG', curYear: '2nd Year', curAY: '2026-27', email: 'swathi.r@gmail.com', phone: '9876543231', gender: 'Female', father: 'N Reddy', history: [{ y: '1st Year', ay: '2025-26' }, { y: '2nd Year', ay: '2026-27' }] },
    ];

    const createdStudents = [];
    for (const s of studentData) {
      const student = await Student.create({
        studentId: s.id,
        admissionNo: s.adm,
        name: s.name,
        course: s.course,
        level: s.level,
        currentYear: s.curYear,
        currentAcademicYear: s.curAY,
        enrollmentHistory: s.history.map(h => ({ year: h.y, academicYear: h.ay, promotedAt: new Date() })),
        email: s.email,
        phone: s.phone,
        gender: s.gender,
        fatherName: s.father,
        status: s.status || 'Active'
      });
      createdStudents.push(student);
    }
    console.log(`Created ${createdStudents.length} students`);

    // ==================== FEE DEMANDS ====================
    // Create fee demands for each student based on their enrollment history
    for (const student of createdStudents) {
      for (const enrollment of student.enrollmentHistory) {
        const structures = await FeeStructure.find({
          course: student.course,
          level: student.level,
          year: enrollment.year,
          academicYear: enrollment.academicYear,
          status: 'active'
        });

        if (structures.length > 0) {
          const cats = structures.map(s => ({ category: s.category, amount: s.amount }));
          const totalDemand = cats.reduce((sum, c) => sum + c.amount, 0);

          await FeeDemand.create({
            student: student._id,
            studentId: student.studentId,
            academicYear: enrollment.academicYear,
            year: enrollment.year,
            course: student.course,
            level: student.level,
            categories: cats,
            totalDemand,
            createdBy: users[0]._id
          });
        }
      }
    }
    console.log('Created fee demands');

    // ==================== PAYMENTS ====================
    const paymentModes = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];
    let receiptCounter = 1;

    const paymentEntries = [
      // STU-0001 Ravi Kumar: Fully paid 1st year, partially paid 2nd year, small payment 3rd year
      { sid: 'STU-0001', ay: '2024-25', amount: 50000, date: '2024-07-15', mode: 'UPI', txn: 'UPI202407001' },
      { sid: 'STU-0001', ay: '2025-26', amount: 30000, date: '2025-07-20', mode: 'Cash', txn: '' },
      { sid: 'STU-0001', ay: '2025-26', amount: 10000, date: '2025-12-05', mode: 'UPI', txn: 'UPI202512001' },
      { sid: 'STU-0001', ay: '2026-27', amount: 15000, date: '2026-07-10', mode: 'Bank Transfer', txn: 'NEFT202607001' },

      // STU-0002 Ananya: Fully paid all years
      { sid: 'STU-0002', ay: '2024-25', amount: 50000, date: '2024-06-20', mode: 'Bank Transfer', txn: 'NEFT202406001' },
      { sid: 'STU-0002', ay: '2025-26', amount: 48000, date: '2025-06-25', mode: 'Bank Transfer', txn: 'NEFT202506001' },
      { sid: 'STU-0002', ay: '2026-27', amount: 51000, date: '2026-06-20', mode: 'UPI', txn: 'UPI202606001' },

      // STU-0003 Karthik: Never paid 1st year, partial 2nd, no 3rd year payment (big dues)
      { sid: 'STU-0003', ay: '2024-25', amount: 20000, date: '2024-09-10', mode: 'Cash', txn: '' },
      { sid: 'STU-0003', ay: '2025-26', amount: 15000, date: '2025-08-15', mode: 'Cheque', txn: 'CHQ-345678' },

      // STU-0004 Deepika: Fully paid 1st year, partial 2nd year
      { sid: 'STU-0004', ay: '2025-26', amount: 52000, date: '2025-07-05', mode: 'UPI', txn: 'UPI202507001' },
      { sid: 'STU-0004', ay: '2026-27', amount: 25000, date: '2026-07-15', mode: 'Cash', txn: '' },

      // STU-0005 Arjun: Partial both years
      { sid: 'STU-0005', ay: '2025-26', amount: 30000, date: '2025-07-20', mode: 'Card', txn: 'CC-202507-001' },
      { sid: 'STU-0005', ay: '2026-27', amount: 20000, date: '2026-08-01', mode: 'UPI', txn: 'UPI202608001' },

      // STU-0006 Sneha: Just joined, paid fully
      { sid: 'STU-0006', ay: '2026-27', amount: 56500, date: '2026-06-15', mode: 'Bank Transfer', txn: 'NEFT202606002' },

      // STU-0007 Vikram: Fully paid 1st and 2nd, partial 3rd
      { sid: 'STU-0007', ay: '2024-25', amount: 41000, date: '2024-06-25', mode: 'Cash', txn: '' },
      { sid: 'STU-0007', ay: '2025-26', amount: 38000, date: '2025-07-10', mode: 'UPI', txn: 'UPI202507002' },
      { sid: 'STU-0007', ay: '2026-27', amount: 20000, date: '2026-07-20', mode: 'Cash', txn: '' },

      // STU-0008 Pooja: Fully paid 1st year, no 2nd year payment
      { sid: 'STU-0008', ay: '2025-26', amount: 43000, date: '2025-06-30', mode: 'Bank Transfer', txn: 'NEFT202506002' },

      // STU-0009 Rahul: Just joined, partial
      { sid: 'STU-0009', ay: '2026-27', amount: 25000, date: '2026-07-01', mode: 'UPI', txn: 'UPI202607001' },

      // STU-0010 Meera: Fully paid all years
      { sid: 'STU-0010', ay: '2024-25', amount: 39000, date: '2024-07-05', mode: 'Cash', txn: '' },
      { sid: 'STU-0010', ay: '2025-26', amount: 37000, date: '2025-07-08', mode: 'UPI', txn: 'UPI202507003' },
      { sid: 'STU-0010', ay: '2026-27', amount: 41000, date: '2026-07-05', mode: 'Bank Transfer', txn: 'NEFT202607001' },

      // STU-0011 Aditya: Partial 1st, no 2nd
      { sid: 'STU-0011', ay: '2025-26', amount: 20000, date: '2025-08-20', mode: 'Card', txn: 'CC-202508-001' },

      // STU-0012 Kavitha: Just joined, no payment
      // No payments

      // STU-0013 Sanjay MBA: Partial 1st year, partial 2nd year
      { sid: 'STU-0013', ay: '2025-26', amount: 60000, date: '2025-07-15', mode: 'Bank Transfer', txn: 'NEFT202507001' },
      { sid: 'STU-0013', ay: '2026-27', amount: 40000, date: '2026-07-20', mode: 'UPI', txn: 'UPI202607002' },

      // STU-0014 Nandini MBA: Fully paid both
      { sid: 'STU-0014', ay: '2025-26', amount: 80000, date: '2025-06-20', mode: 'Bank Transfer', txn: 'NEFT202506003' },
      { sid: 'STU-0014', ay: '2026-27', amount: 75000, date: '2026-06-22', mode: 'Bank Transfer', txn: 'NEFT202606003' },

      // STU-0015 Rohit MBA: New, partial payment
      { sid: 'STU-0015', ay: '2026-27', amount: 50000, date: '2026-07-05', mode: 'Cheque', txn: 'CHQ-789012' },

      // STU-0016 Lakshmi MCA: Partial 1st, partial 2nd
      { sid: 'STU-0016', ay: '2025-26', amount: 50000, date: '2025-07-25', mode: 'UPI', txn: 'UPI202507004' },
      { sid: 'STU-0016', ay: '2025-26', amount: 15000, date: '2025-11-10', mode: 'Cash', txn: '' },
      { sid: 'STU-0016', ay: '2026-27', amount: 30000, date: '2026-08-05', mode: 'Card', txn: 'CC-202608-001' },

      // STU-0017 Amit MCA: New, fully paid
      { sid: 'STU-0017', ay: '2026-27', amount: 81500, date: '2026-06-18', mode: 'Bank Transfer', txn: 'NEFT202606004' },

      // STU-0018 Divya MSc: Paid 1st, partial 2nd
      { sid: 'STU-0018', ay: '2025-26', amount: 59000, date: '2025-06-28', mode: 'UPI', txn: 'UPI202506001' },
      { sid: 'STU-0018', ay: '2026-27', amount: 30000, date: '2026-07-30', mode: 'Cash', txn: '' },

      // STU-0019 Suresh MSc: New, no payment
      // No payments

      // STU-0021 Harish: New BCA 1st year, partial
      { sid: 'STU-0021', ay: '2026-27', amount: 30000, date: '2026-07-12', mode: 'UPI', txn: 'UPI202607003' },

      // STU-0022 Swathi: Paid 1st year, partial 2nd year
      { sid: 'STU-0022', ay: '2025-26', amount: 52000, date: '2025-07-01', mode: 'Bank Transfer', txn: 'NEFT202507002' },
      { sid: 'STU-0022', ay: '2026-27', amount: 20000, date: '2026-08-10', mode: 'UPI', txn: 'UPI202608002' },
    ];

    for (const p of paymentEntries) {
      const student = createdStudents.find(s => s.studentId === p.sid);
      if (!student) continue;

      const enrollment = student.enrollmentHistory.find(e => e.academicYear === p.ay);
      const yr = enrollment ? enrollment.year : student.currentYear;

      await Payment.create({
        receiptNo: `REC-${p.date.substring(0, 4)}-${String(receiptCounter++).padStart(5, '0')}`,
        student: student._id,
        studentId: student.studentId,
        academicYear: p.ay,
        year: yr,
        allocations: [],
        amountPaid: p.amount,
        paymentDate: new Date(p.date),
        paymentMode: p.mode,
        transactionId: p.txn,
        remarks: '',
        enteredBy: users[1]._id,
        enteredByName: users[1].name,
        status: 'completed'
      });
    }
    console.log(`Created ${receiptCounter - 1} payments`);

    // ==================== AUDIT LOGS ====================
    await AuditLog.create({
      timestamp: new Date(),
      userName: 'System',
      userRole: 'system',
      action: 'Database Seeded',
      entity: 'System',
      description: `Database seeded with ${createdStudents.length} students, ${receiptCounter - 1} payments, and ${feeStructures.length} fee structures`
    });

    console.log('\n=== SEED COMPLETE ===');
    console.log(`Students: ${createdStudents.length}`);
    console.log(`Fee Structures: ${feeStructures.length}`);
    console.log(`Payments: ${receiptCounter - 1}`);
    console.log('\nLogin credentials:');
    console.log('  Admin:      admin / admin123');
    console.log('  Accountant: suresh / acc123');
    console.log('  Accountant: priya / acc123');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
}

seed();

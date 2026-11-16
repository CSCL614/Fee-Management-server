require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');

const User = require('../models/User');
const Student = require('../models/Student');
const Course = require('../models/Course');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');

async function seedAlumniData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB for Alumni & Suggestion Seeding...');

    const admin = await User.findOne({ role: 'admin' }) || { _id: new mongoose.Types.ObjectId(), name: 'Dr. Ramesh Kumar' };

    // 1. Ensure courses are present in Course collection
    const coursesData = [
      { degree: 'B.Sc', specialization: 'Computer Science', duration: 3, level: 'UG', courseName: 'B.Sc Computer Science' },
      { degree: 'B.Com', specialization: 'Computer Application', duration: 3, level: 'UG', courseName: 'B.Com Computer Application' },
      { degree: 'M.Sc', specialization: 'Organic Chemistry', duration: 2, level: 'PG', courseName: 'M.Sc Organic Chemistry' },
      { degree: 'B.Sc', specialization: 'Zoology', duration: 3, level: 'UG', courseName: 'B.Sc Zoology' },
      { degree: 'B.Sc', specialization: 'Chemistry', duration: 3, level: 'UG', courseName: 'B.Sc Chemistry' }
    ];

    const courseDocMap = new Map();
    for (const c of coursesData) {
      let doc = await Course.findOne({ courseName: c.courseName });
      if (!doc) {
        doc = await Course.create({
          courseId: `CRS-${c.degree.replace(/[^A-Z]/g, '')}-${c.specialization.slice(0, 3).toUpperCase()}`,
          degree: c.degree,
          specialization: c.specialization,
          duration: c.duration,
          level: c.level,
          courseName: c.courseName,
          status: 'active'
        });
      }
      courseDocMap.set(c.courseName, doc);
    }

    // 2. Dummy Graduated Alumni Data
    const dummyAlumni = [
      {
        studentId: 'ALUM-2026-001',
        admissionNo: 'AU2023CS001',
        name: 'Kavitha Varma',
        gender: 'Female',
        email: 'kavitha.varma@alumni.srisaicollege.edu.in',
        phone: '9848011221',
        course: 'B.Sc Computer Science',
        degree: 'B.Sc',
        specialization: 'Computer Science',
        level: 'UG',
        duration: 3,
        admissionYear: 2023,
        batchStartYear: 2023,
        batchEndYear: 2026,
        currentYear: '3rd Year',
        currentAcademicYear: '2025-26',
        status: 'Graduated',
        graduation: {
          passingYear: 2026,
          passingAcademicYear: '2025-26',
          completionDate: new Date('2026-05-15'),
          graduatedAt: new Date('2026-05-20'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Outstanding student with distinction across all 6 semesters.',
          academicResult: {
            course: 'B.Sc Computer Science',
            specialization: 'Computer Science',
            admissionYear: 2023,
            passingYear: 2026,
            finalSemester: 'Semester VI',
            resultStatus: 'First Class Distinction',
            percentage: 89.5,
            cgpa: 9.42,
            gradeOrDivision: 'First Class with Distinction',
            universityRegNo: 'AU2023CS001',
            resultDate: new Date('2026-05-18'),
            remarks: 'Gold Medalist in Computer Science'
          }
        },
        fee: { total: 45000, paid: 45000 } // Cleared
      },
      {
        studentId: 'ALUM-2026-002',
        admissionNo: 'AU2023CS014',
        name: 'Sai Teja Naidu',
        gender: 'Male',
        email: 'saiteja.naidu@alumni.srisaicollege.edu.in',
        phone: '9848022332',
        course: 'B.Sc Computer Science',
        degree: 'B.Sc',
        specialization: 'Computer Science',
        level: 'UG',
        duration: 3,
        admissionYear: 2023,
        batchStartYear: 2023,
        batchEndYear: 2026,
        currentYear: '3rd Year',
        currentAcademicYear: '2025-26',
        status: 'Graduated',
        graduation: {
          passingYear: 2026,
          passingAcademicYear: '2025-26',
          completionDate: new Date('2026-05-15'),
          graduatedAt: new Date('2026-05-20'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Completed 6 semesters successfully.',
          academicResult: {
            course: 'B.Sc Computer Science',
            specialization: 'Computer Science',
            admissionYear: 2023,
            passingYear: 2026,
            finalSemester: 'Semester VI',
            resultStatus: 'First Class',
            percentage: 77.2,
            cgpa: 8.15,
            gradeOrDivision: 'First Class',
            universityRegNo: 'AU2023CS014',
            resultDate: new Date('2026-05-18'),
            remarks: 'Consistent academic performance'
          }
        },
        fee: { total: 45000, paid: 40000 } // Pending 5000
      },
      {
        studentId: 'ALUM-2026-003',
        admissionNo: 'AU2023BC022',
        name: 'Lavanya Kumari',
        gender: 'Female',
        email: 'lavanya.kumari@alumni.srisaicollege.edu.in',
        phone: '9848033443',
        course: 'B.Com Computer Application',
        degree: 'B.Com',
        specialization: 'Computer Application',
        level: 'UG',
        duration: 3,
        admissionYear: 2023,
        batchStartYear: 2023,
        batchEndYear: 2026,
        currentYear: '3rd Year',
        currentAcademicYear: '2025-26',
        status: 'Graduated',
        graduation: {
          passingYear: 2026,
          passingAcademicYear: '2025-26',
          completionDate: new Date('2026-05-14'),
          graduatedAt: new Date('2026-05-22'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Cleared degree with University top 5 rank in Commerce.',
          academicResult: {
            course: 'B.Com Computer Application',
            specialization: 'Computer Application',
            admissionYear: 2023,
            passingYear: 2026,
            finalSemester: 'Semester VI',
            resultStatus: 'First Class Distinction',
            percentage: 92.0,
            cgpa: 9.60,
            gradeOrDivision: 'First Class with Distinction',
            universityRegNo: 'AU2023BC022',
            resultDate: new Date('2026-05-18'),
            remarks: 'Rank 3 in Andhra University Affiliated Colleges'
          }
        },
        fee: { total: 38000, paid: 38000 } // Cleared
      },
      {
        studentId: 'ALUM-2025-004',
        admissionNo: 'AU2022BC045',
        name: 'Venkata Ramana Raju',
        gender: 'Male',
        email: 'venkata.ramana@alumni.srisaicollege.edu.in',
        phone: '9848044554',
        course: 'B.Com Computer Application',
        degree: 'B.Com',
        specialization: 'Computer Application',
        level: 'UG',
        duration: 3,
        admissionYear: 2022,
        batchStartYear: 2022,
        batchEndYear: 2025,
        currentYear: '3rd Year',
        currentAcademicYear: '2024-25',
        status: 'Graduated',
        graduation: {
          passingYear: 2025,
          passingAcademicYear: '2024-25',
          completionDate: new Date('2025-05-20'),
          graduatedAt: new Date('2025-05-28'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Graduated in 2024-25 session.',
          academicResult: {
            course: 'B.Com Computer Application',
            specialization: 'Computer Application',
            admissionYear: 2022,
            passingYear: 2025,
            finalSemester: 'Semester VI',
            resultStatus: 'Second Class',
            percentage: 64.0,
            cgpa: 6.85,
            gradeOrDivision: 'Second Class',
            universityRegNo: 'AU2022BC045',
            resultDate: new Date('2025-05-22'),
            remarks: 'Active sports representative'
          }
        },
        fee: { total: 38000, paid: 34500 } // Pending 3500
      },
      {
        studentId: 'ALUM-2026-005',
        admissionNo: 'AU2024MS008',
        name: 'Deepak Reddy',
        gender: 'Male',
        email: 'deepak.reddy@alumni.srisaicollege.edu.in',
        phone: '9848055665',
        course: 'M.Sc Organic Chemistry',
        degree: 'M.Sc',
        specialization: 'Organic Chemistry',
        level: 'PG',
        duration: 2,
        admissionYear: 2024,
        batchStartYear: 2024,
        batchEndYear: 2026,
        currentYear: '2nd Year',
        currentAcademicYear: '2025-26',
        status: 'Graduated',
        graduation: {
          passingYear: 2026,
          passingAcademicYear: '2025-26',
          completionDate: new Date('2026-06-10'),
          graduatedAt: new Date('2026-06-15'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'PG Degree with research dissertation completed.',
          academicResult: {
            course: 'M.Sc Organic Chemistry',
            specialization: 'Organic Chemistry',
            admissionYear: 2024,
            passingYear: 2026,
            finalSemester: 'Semester IV',
            resultStatus: 'First Class Distinction',
            percentage: 86.4,
            cgpa: 9.10,
            gradeOrDivision: 'First Class with Distinction',
            universityRegNo: 'AU2024MS008',
            resultDate: new Date('2026-06-12'),
            remarks: 'Published paper in National Chemical Science Journal'
          }
        },
        fee: { total: 52000, paid: 52000 } // Cleared
      },
      {
        studentId: 'ALUM-2025-006',
        admissionNo: 'AU2023MS011',
        name: 'Swathi Priya',
        gender: 'Female',
        email: 'swathi.priya@alumni.srisaicollege.edu.in',
        phone: '9848066776',
        course: 'M.Sc Organic Chemistry',
        degree: 'M.Sc',
        specialization: 'Organic Chemistry',
        level: 'PG',
        duration: 2,
        admissionYear: 2023,
        batchStartYear: 2023,
        batchEndYear: 2025,
        currentYear: '2nd Year',
        currentAcademicYear: '2024-25',
        status: 'Graduated',
        graduation: {
          passingYear: 2025,
          passingAcademicYear: '2024-25',
          completionDate: new Date('2025-06-08'),
          graduatedAt: new Date('2025-06-14'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Completed M.Sc degree.',
          academicResult: {
            course: 'M.Sc Organic Chemistry',
            specialization: 'Organic Chemistry',
            admissionYear: 2023,
            passingYear: 2025,
            finalSemester: 'Semester IV',
            resultStatus: 'First Class',
            percentage: 78.9,
            cgpa: 8.30,
            gradeOrDivision: 'First Class',
            universityRegNo: 'AU2023MS011',
            resultDate: new Date('2025-06-10'),
            remarks: 'Specialized in Spectroscopic Techniques'
          }
        },
        fee: { total: 52000, paid: 44000 } // Pending 8000
      },
      {
        studentId: 'ALUM-2025-007',
        admissionNo: 'AU2022BZ019',
        name: 'Naveen Kumar Naidu',
        gender: 'Male',
        email: 'naveen.naidu@alumni.srisaicollege.edu.in',
        phone: '9848077887',
        course: 'B.Sc Zoology',
        degree: 'B.Sc',
        specialization: 'Zoology',
        level: 'UG',
        duration: 3,
        admissionYear: 2022,
        batchStartYear: 2022,
        batchEndYear: 2025,
        currentYear: '3rd Year',
        currentAcademicYear: '2024-25',
        status: 'Graduated',
        graduation: {
          passingYear: 2025,
          passingAcademicYear: '2024-25',
          completionDate: new Date('2025-05-18'),
          graduatedAt: new Date('2025-05-25'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Cleared in supplementary examination.',
          academicResult: {
            course: 'B.Sc Zoology',
            specialization: 'Zoology',
            admissionYear: 2022,
            passingYear: 2025,
            finalSemester: 'Semester VI',
            resultStatus: 'Passed with Compartment',
            percentage: 55.2,
            cgpa: 5.90,
            gradeOrDivision: 'Pass Class',
            universityRegNo: 'AU2022BZ019',
            resultDate: new Date('2025-07-02'),
            remarks: 'Cleared Genetics supplementary'
          }
        },
        fee: { total: 36000, paid: 36000 } // Cleared
      },
      {
        studentId: 'ALUM-2024-008',
        admissionNo: 'AU2021BC005',
        name: 'Meenakshi Sundaram',
        gender: 'Female',
        email: 'meenakshi.s@alumni.srisaicollege.edu.in',
        phone: '9848088998',
        course: 'B.Sc Chemistry',
        degree: 'B.Sc',
        specialization: 'Chemistry',
        level: 'UG',
        duration: 3,
        admissionYear: 2021,
        batchStartYear: 2021,
        batchEndYear: 2024,
        currentYear: '3rd Year',
        currentAcademicYear: '2023-24',
        status: 'Graduated',
        graduation: {
          passingYear: 2024,
          passingAcademicYear: '2023-24',
          completionDate: new Date('2024-05-12'),
          graduatedAt: new Date('2024-05-20'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Batch of 2024 Distinction Graduate.',
          academicResult: {
            course: 'B.Sc Chemistry',
            specialization: 'Chemistry',
            admissionYear: 2021,
            passingYear: 2024,
            finalSemester: 'Semester VI',
            resultStatus: 'First Class Distinction',
            percentage: 88.0,
            cgpa: 9.25,
            gradeOrDivision: 'First Class with Distinction',
            universityRegNo: 'AU2021BC005',
            resultDate: new Date('2024-05-15'),
            remarks: 'Pursuing Ph.D. at Central University'
          }
        },
        fee: { total: 35000, paid: 35000 } // Cleared
      },
      {
        studentId: 'ALUM-2024-009',
        admissionNo: 'AU2021CS032',
        name: 'Chaitanya Krishna',
        gender: 'Male',
        email: 'chaitanya.k@alumni.srisaicollege.edu.in',
        phone: '9848099009',
        course: 'B.Sc Computer Science',
        degree: 'B.Sc',
        specialization: 'Computer Science',
        level: 'UG',
        duration: 3,
        admissionYear: 2021,
        batchStartYear: 2021,
        batchEndYear: 2024,
        currentYear: '3rd Year',
        currentAcademicYear: '2023-24',
        status: 'Graduated',
        graduation: {
          passingYear: 2024,
          passingAcademicYear: '2023-24',
          completionDate: new Date('2024-05-16'),
          graduatedAt: new Date('2024-05-24'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Graduated in 2024 with campus placement.',
          academicResult: {
            course: 'B.Sc Computer Science',
            specialization: 'Computer Science',
            admissionYear: 2021,
            passingYear: 2024,
            finalSemester: 'Semester VI',
            resultStatus: 'First Class',
            percentage: 80.5,
            cgpa: 8.45,
            gradeOrDivision: 'First Class',
            universityRegNo: 'AU2021CS032',
            resultDate: new Date('2024-05-19'),
            remarks: 'Placed in TCS Software Engineering'
          }
        },
        fee: { total: 42000, paid: 38000 } // Pending 4000
      },
      {
        studentId: 'ALUM-2023-010',
        admissionNo: 'AU2020BC088',
        name: 'Geetanjali Rao',
        gender: 'Female',
        email: 'geetanjali.rao@alumni.srisaicollege.edu.in',
        phone: '9848100110',
        course: 'B.Com Computer Application',
        degree: 'B.Com',
        specialization: 'Computer Application',
        level: 'UG',
        duration: 3,
        admissionYear: 2020,
        batchStartYear: 2020,
        batchEndYear: 2023,
        currentYear: '3rd Year',
        currentAcademicYear: '2022-23',
        status: 'Graduated',
        graduation: {
          passingYear: 2023,
          passingAcademicYear: '2022-23',
          completionDate: new Date('2023-05-15'),
          graduatedAt: new Date('2023-05-25'),
          graduatedBy: admin._id,
          graduatedByName: admin.name,
          graduationRemarks: 'Class of 2023 Graduate.',
          academicResult: {
            course: 'B.Com Computer Application',
            specialization: 'Computer Application',
            admissionYear: 2020,
            passingYear: 2023,
            finalSemester: 'Semester VI',
            resultStatus: 'First Class',
            percentage: 74.5,
            cgpa: 7.90,
            gradeOrDivision: 'First Class',
            universityRegNo: 'AU2020BC088',
            resultDate: new Date('2023-05-20'),
            remarks: 'Banking & Financial Analysis Specialization'
          }
        },
        fee: { total: 34000, paid: 34000 } // Cleared
      }
    ];

    let insertedAlumniCount = 0;

    for (const data of dummyAlumni) {
      const courseDoc = courseDocMap.get(data.course);
      data.courseId = courseDoc ? courseDoc._id : null;

      // Upsert student
      let student = await Student.findOne({ studentId: data.studentId });
      if (student) {
        Object.assign(student, data);
        await student.save();
      } else {
        student = await Student.create(data);
      }
      insertedAlumniCount++;

      // Create matching FeeDemand
      await FeeDemand.deleteMany({ student: student._id });
      await Payment.deleteMany({ student: student._id });

      const tuitionAmt = data.fee.total - 10000;
      const examAmt = 5000;
      const labAmt = 5000;
      const demandAcademicYear = data.graduation.passingAcademicYear || '2025-26';

      await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear: demandAcademicYear,
        year: data.currentYear,
        course: data.course,
        level: data.level,
        categories: [
          { category: 'Tuition Fee', amount: tuitionAmt, frequency: 'ANNUAL' },
          { category: 'Examination Fee', amount: examAmt, frequency: 'SEMESTER' },
          { category: 'Laboratory Fee', amount: labAmt, frequency: 'ANNUAL' }
        ],
        totalDemand: data.fee.total,
        status: 'active'
      });

      // Create Payment installments
      if (data.fee.paid > 0) {
        // Installment 1: First half
        const p1Amt = Math.min(20000, data.fee.paid);
        await Payment.create({
          receiptNo: `REC-${data.graduation.passingYear}-80${student.studentId.replace(/\D/g, '').slice(-3)}1`,
          student: student._id,
          studentId: student.studentId,
          academicYear: demandAcademicYear,
          year: data.currentYear,
          feeCategory: 'Tuition Fee',
          amountPaid: p1Amt,
          paymentMode: 'Bank Transfer',
          paymentDate: new Date(data.graduation.completionDate.getTime() - 120 * 24 * 60 * 60 * 1000), // ~4 months before
          status: 'completed',
          enteredBy: admin._id,
          enteredByName: admin.name,
          recordedBy: admin._id,
          recordedByName: admin.name,
          allocations: [
            { academicYear: demandAcademicYear, year: data.currentYear, category: 'Tuition Fee', amount: p1Amt }
          ],
          remarks: 'Installment 1 Fee Payment'
        });

        // Installment 2: Remainder of paid amount
        const p2Amt = data.fee.paid - p1Amt;
        if (p2Amt > 0) {
          const tuitionRemaining = Math.max(0, tuitionAmt - p1Amt);
          const p2Tuition = Math.min(tuitionRemaining, p2Amt);
          const p2Exam = p2Amt - p2Tuition;

          const allocs = [];
          if (p2Tuition > 0) {
            allocs.push({ academicYear: demandAcademicYear, year: data.currentYear, category: 'Tuition Fee', amount: p2Tuition });
          }
          if (p2Exam > 0) {
            allocs.push({ academicYear: demandAcademicYear, year: data.currentYear, category: 'Examination Fee', amount: p2Exam });
          }

          await Payment.create({
            receiptNo: `REC-${data.graduation.passingYear}-80${student.studentId.replace(/\D/g, '').slice(-3)}2`,
            student: student._id,
            studentId: student.studentId,
            academicYear: demandAcademicYear,
            year: data.currentYear,
            feeCategory: p2Tuition > 0 ? 'Tuition Fee' : 'Examination Fee',
            amountPaid: p2Amt,
            paymentMode: 'UPI',
            paymentDate: new Date(data.graduation.completionDate.getTime() - 30 * 24 * 60 * 60 * 1000), // ~1 month before
            status: 'completed',
            enteredBy: admin._id,
            enteredByName: admin.name,
            recordedBy: admin._id,
            recordedByName: admin.name,
            allocations: allocs,
            remarks: 'Installment 2 Settlement'
          });
        }
      }
    }

    console.log(`Successfully seeded ${insertedAlumniCount} graduated alumni records with demands & payments.`);

    // 3. Ensure 4 Active students are Final-Year Candidates eligible for Graduation Suggestions
    const candidates = [
      {
        admissionNo: 'BSC2023055',
        name: 'Sravan Varma',
        gender: 'Male',
        phone: '9848200111',
        email: 'sravan.v@srisaicollege.edu.in',
        course: 'B.Sc Computer Science',
        degree: 'B.Sc',
        specialization: 'Computer Science',
        level: 'UG',
        duration: 3,
        admissionYear: 2023,
        batchStartYear: 2023,
        batchEndYear: 2026,
        currentYear: '3rd Year',
        currentAcademicYear: '2025-26',
        status: 'Active'
      },
      {
        admissionNo: 'BCOM2023062',
        name: 'Pallavi Rao',
        gender: 'Female',
        phone: '9848200222',
        email: 'pallavi.r@srisaicollege.edu.in',
        course: 'B.Com Computer Application',
        degree: 'B.Com',
        specialization: 'Computer Application',
        level: 'UG',
        duration: 3,
        admissionYear: 2023,
        batchStartYear: 2023,
        batchEndYear: 2026,
        currentYear: '3rd Year',
        currentAcademicYear: '2025-26',
        status: 'Active'
      },
      {
        admissionNo: 'MSC2024075',
        name: 'Karthik Sharma',
        gender: 'Male',
        phone: '9848200333',
        email: 'karthik.s@srisaicollege.edu.in',
        course: 'M.Sc Organic Chemistry',
        degree: 'M.Sc',
        specialization: 'Organic Chemistry',
        level: 'PG',
        duration: 2,
        admissionYear: 2024,
        batchStartYear: 2024,
        batchEndYear: 2026,
        currentYear: '2nd Year',
        currentAcademicYear: '2025-26',
        status: 'Active'
      },
      {
        admissionNo: 'BSC2023081',
        name: 'Madhuri Devi',
        gender: 'Female',
        phone: '9848200444',
        email: 'madhuri.d@srisaicollege.edu.in',
        course: 'B.Sc Zoology',
        degree: 'B.Sc',
        specialization: 'Zoology',
        level: 'UG',
        duration: 3,
        admissionYear: 2023,
        batchStartYear: 2023,
        batchEndYear: 2026,
        currentYear: '3rd Year',
        currentAcademicYear: '2025-26',
        status: 'Active'
      }
    ];

    let candidateCount = 0;
    for (const cand of candidates) {
      const courseDoc = courseDocMap.get(cand.course);
      cand.courseId = courseDoc ? courseDoc._id : null;

      let student = await Student.findOne({ admissionNo: cand.admissionNo });
      if (!student) {
        cand.studentId = `STU-CAND-${100 + candidateCount}`;
        student = await Student.create(cand);
      } else {
        Object.assign(student, cand);
        await student.save();
      }

      // Add a fee demand for the candidate so dues are tracked
      await FeeDemand.deleteMany({ student: student._id });
      await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear: '2025-26',
        year: cand.currentYear,
        course: cand.course,
        level: cand.level,
        categories: [
          { category: 'Tuition Fee', amount: 35000, frequency: 'ANNUAL' },
          { category: 'Examination Fee', amount: 3000, frequency: 'SEMESTER' }
        ],
        totalDemand: 38000,
        status: 'active'
      });
      await Payment.deleteMany({ student: student._id });
      await Payment.create({
        receiptNo: `REC-2026-99${10 + candidateCount}`,
        student: student._id,
        studentId: student.studentId,
        academicYear: '2025-26',
        year: cand.currentYear,
        feeCategory: 'Tuition Fee',
        amountPaid: 38000,
        paymentMode: 'Bank Transfer',
        paymentDate: new Date('2026-02-10'),
        status: 'completed',
        enteredBy: admin._id,
        enteredByName: admin.name,
        recordedBy: admin._id,
        recordedByName: admin.name,
        allocations: [
          { academicYear: '2025-26', year: cand.currentYear, category: 'Tuition Fee', amount: 35000 },
          { academicYear: '2025-26', year: cand.currentYear, category: 'Examination Fee', amount: 3000 }
        ]
      });

      candidateCount++;
    }

    console.log(`Successfully verified/seeded ${candidateCount} final-year active graduation candidates.`);
    console.log('\n--- Seeding Complete! ---');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seedAlumniData();

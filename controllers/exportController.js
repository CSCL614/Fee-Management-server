const ExcelJS = require('exceljs');
const Student = require('../models/Student');
const Payment = require('../models/Payment');
const FeeStructure = require('../models/FeeStructure');
const FeeDemand = require('../models/FeeDemand');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { calculateFeeSummary } = require('../utils/feeCalculator');

// @desc    Full Excel export (all data)
// @route   GET /api/exports/excel
exports.exportFullExcel = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'College Fee Management System';
    workbook.created = new Date();

    // Sheet 1: Students
    const studentsSheet = workbook.addWorksheet('Students');
    studentsSheet.columns = [
      { header: 'Student ID', key: 'studentId', width: 15 },
      { header: 'Admission No', key: 'admissionNo', width: 18 },
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Course', key: 'course', width: 12 },
      { header: 'Level', key: 'level', width: 8 },
      { header: 'Year', key: 'currentYear', width: 12 },
      { header: 'Academic Year', key: 'currentAcademicYear', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    const students = await Student.find().sort({ studentId: 1 });
    students.forEach(s => studentsSheet.addRow(s.toObject()));
    styleHeader(studentsSheet);

    // Sheet 2: Fee Structure
    const feeSheet = workbook.addWorksheet('Fee_Structure');
    feeSheet.columns = [
      { header: 'Fee ID', key: 'feeId', width: 12 },
      { header: 'Course', key: 'course', width: 12 },
      { header: 'Level', key: 'level', width: 8 },
      { header: 'Year', key: 'year', width: 12 },
      { header: 'Academic Year', key: 'academicYear', width: 15 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Amount', key: 'amount', width: 15 }
    ];
    const feeStructures = await FeeStructure.find({ status: 'active' }).sort({ course: 1 });
    feeStructures.forEach(f => feeSheet.addRow(f.toObject()));
    styleHeader(feeSheet);

    // Sheet 3: Payments
    const paymentsSheet = workbook.addWorksheet('Payments');
    paymentsSheet.columns = [
      { header: 'Receipt No', key: 'receiptNo', width: 18 },
      { header: 'Student ID', key: 'studentId', width: 15 },
      { header: 'Academic Year', key: 'academicYear', width: 15 },
      { header: 'Year', key: 'year', width: 12 },
      { header: 'Amount Paid', key: 'amountPaid', width: 15 },
      { header: 'Payment Date', key: 'paymentDate', width: 15 },
      { header: 'Payment Mode', key: 'paymentMode', width: 15 },
      { header: 'Transaction ID', key: 'transactionId', width: 20 },
      { header: 'Remarks', key: 'remarks', width: 25 },
      { header: 'Entered By', key: 'enteredByName', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created At', key: 'createdAt', width: 18 }
    ];
    const payments = await Payment.find().sort({ paymentDate: -1 });
    payments.forEach(p => {
      const row = p.toObject();
      row.paymentDate = p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-IN') : '';
      row.createdAt = p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '';
      paymentsSheet.addRow(row);
    });
    styleHeader(paymentsSheet);

    // Sheet 4: Fee Summary
    const summarySheet = workbook.addWorksheet('Fee_Summary');
    summarySheet.columns = [
      { header: 'Student ID', key: 'studentId', width: 15 },
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Course', key: 'course', width: 12 },
      { header: 'Academic Year', key: 'academicYear', width: 15 },
      { header: 'Year', key: 'year', width: 12 },
      { header: 'Current Year Fee', key: 'currentYearFee', width: 18 },
      { header: 'Previous Year Due', key: 'previousYearDue', width: 18 },
      { header: 'Total Payable', key: 'totalPayable', width: 15 },
      { header: 'Total Paid', key: 'totalPaid', width: 15 },
      { header: 'Pending', key: 'pending', width: 15 },
      { header: 'Status', key: 'status', width: 12 }
    ];

    for (const student of students) {
      try {
        const summary = await calculateFeeSummary(student.studentId);
        for (const ys of summary.yearSummaries) {
          summarySheet.addRow({
            studentId: student.studentId,
            name: student.name,
            course: student.course,
            academicYear: ys.academicYear,
            year: ys.year,
            currentYearFee: ys.currentYearFee,
            previousYearDue: ys.previousYearDue,
            totalPayable: ys.totalPayable,
            totalPaid: ys.totalPaid,
            pending: ys.pending,
            status: ys.status
          });
        }
      } catch { /* skip */ }
    }
    styleHeader(summarySheet);

    // Sheet 5: Receipt Log
    const receiptSheet = workbook.addWorksheet('Receipt_Log');
    receiptSheet.columns = [
      { header: 'Receipt No', key: 'receiptNo', width: 18 },
      { header: 'Student ID', key: 'studentId', width: 15 },
      { header: 'Amount', key: 'amountPaid', width: 15 },
      { header: 'Email', key: 'emailAddress', width: 25 },
      { header: 'Email Sent', key: 'emailSent', width: 12 },
      { header: 'Sent Date', key: 'emailSentAt', width: 18 }
    ];
    payments.filter(p => p.status === 'completed').forEach(p => {
      receiptSheet.addRow({
        receiptNo: p.receiptNo,
        studentId: p.studentId,
        amountPaid: p.amountPaid,
        emailAddress: p.emailAddress || '',
        emailSent: p.emailSent ? 'Yes' : 'No',
        emailSentAt: p.emailSentAt ? new Date(p.emailSentAt).toLocaleDateString('en-IN') : ''
      });
    });
    styleHeader(receiptSheet);

    // Sheet 6: Users
    const usersSheet = workbook.addWorksheet('Users');
    usersSheet.columns = [
      { header: 'User ID', key: 'userId', width: 12 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Username', key: 'username', width: 18 },
      { header: 'Role', key: 'role', width: 12 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    const users = await User.find().sort({ userId: 1 });
    users.forEach(u => usersSheet.addRow({ userId: u.userId, name: u.name, username: u.username, role: u.role, status: u.status }));
    styleHeader(usersSheet);

    // Sheet 7: Audit Log
    const auditSheet = workbook.addWorksheet('Audit_Log');
    auditSheet.columns = [
      { header: 'Date & Time', key: 'timestamp', width: 22 },
      { header: 'User', key: 'userName', width: 18 },
      { header: 'Action', key: 'action', width: 20 },
      { header: 'Entity', key: 'entity', width: 15 },
      { header: 'Entity ID', key: 'entityId', width: 18 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Reason', key: 'reason', width: 25 }
    ];
    const auditLogs = await AuditLog.find().sort({ timestamp: -1 }).limit(1000);
    auditLogs.forEach(l => {
      auditSheet.addRow({
        timestamp: l.timestamp ? new Date(l.timestamp).toLocaleString('en-IN') : '',
        userName: l.userName,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        description: l.description,
        reason: l.reason || ''
      });
    });
    styleHeader(auditSheet);

    // Send the workbook
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Fee_Management_Export_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

// @desc    Filtered Excel export
// @route   GET /api/exports/filtered-excel
exports.exportFilteredExcel = async (req, res) => {
  try {
    const { type, academicYear, course, level, dateFrom, dateTo } = req.query;
    const workbook = new ExcelJS.Workbook();

    if (type === 'payments') {
      const sheet = workbook.addWorksheet('Payments');
      sheet.columns = [
        { header: 'Receipt No', key: 'receiptNo', width: 18 },
        { header: 'Student ID', key: 'studentId', width: 15 },
        { header: 'Student Name', key: 'studentName', width: 25 },
        { header: 'Course', key: 'course', width: 12 },
        { header: 'Academic Year', key: 'academicYear', width: 15 },
        { header: 'Amount Paid', key: 'amountPaid', width: 15 },
        { header: 'Payment Date', key: 'paymentDate', width: 15 },
        { header: 'Payment Mode', key: 'paymentMode', width: 15 },
        { header: 'Status', key: 'status', width: 12 }
      ];

      const filter = {};
      if (academicYear) filter.academicYear = academicYear;
      if (dateFrom || dateTo) {
        filter.paymentDate = {};
        if (dateFrom) filter.paymentDate.$gte = new Date(dateFrom);
        if (dateTo) filter.paymentDate.$lte = new Date(dateTo + 'T23:59:59.999Z');
      }

      const payments = await Payment.find(filter).populate('student', 'name course');
      payments.forEach(p => {
        sheet.addRow({
          receiptNo: p.receiptNo,
          studentId: p.studentId,
          studentName: p.student?.name || '',
          course: p.student?.course || '',
          academicYear: p.academicYear,
          amountPaid: p.amountPaid,
          paymentDate: new Date(p.paymentDate).toLocaleDateString('en-IN'),
          paymentMode: p.paymentMode,
          status: p.status
        });
      });
      styleHeader(sheet);
    } else if (type === 'pending') {
      const sheet = workbook.addWorksheet('Pending_Fees');
      sheet.columns = [
        { header: 'Student ID', key: 'studentId', width: 15 },
        { header: 'Student Name', key: 'name', width: 25 },
        { header: 'Course', key: 'course', width: 12 },
        { header: 'Level', key: 'level', width: 8 },
        { header: 'Year', key: 'currentYear', width: 12 },
        { header: 'Total Fee', key: 'totalFee', width: 15 },
        { header: 'Total Paid', key: 'totalPaid', width: 15 },
        { header: 'Pending', key: 'totalPending', width: 15 },
        { header: 'Status', key: 'status', width: 12 }
      ];

      const studentFilter = { status: 'Active' };
      if (course) studentFilter.course = course;
      if (level) studentFilter.level = level;

      const students = await Student.find(studentFilter);
      for (const student of students) {
        try {
          const summary = await calculateFeeSummary(student.studentId);
          if (summary.overall.totalPending > 0) {
            sheet.addRow({
              studentId: student.studentId,
              name: student.name,
              course: student.course,
              level: student.level,
              currentYear: student.currentYear,
              totalFee: summary.overall.totalFee,
              totalPaid: summary.overall.totalPaid,
              totalPending: summary.overall.totalPending,
              status: summary.overall.status
            });
          }
        } catch { /* skip */ }
      }
      styleHeader(sheet);
    } else if (type === 'students') {
      const sheet = workbook.addWorksheet('Students');
      sheet.columns = [
        { header: 'Student ID', key: 'studentId', width: 15 },
        { header: 'Admission No', key: 'admissionNo', width: 18 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Course', key: 'course', width: 12 },
        { header: 'Level', key: 'level', width: 8 },
        { header: 'Year', key: 'currentYear', width: 12 },
        { header: 'Email', key: 'email', width: 25 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Status', key: 'status', width: 12 }
      ];

      const studentFilter = {};
      if (course) studentFilter.course = course;
      if (level) studentFilter.level = level;

      const students = await Student.find(studentFilter).sort({ studentId: 1 });
      students.forEach(s => sheet.addRow(s.toObject()));
      styleHeader(sheet);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Fee_Export_${type || 'data'}_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Filtered export error:', error);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

function styleHeader(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;
}

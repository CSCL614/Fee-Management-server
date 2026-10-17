const XLSX = require('xlsx');
const multer = require('multer');
const Student = require('../models/Student');
const Course = require('../models/Course');
const FeeStructure = require('../models/FeeStructure');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const { createAuditLog, generateId, generateReceiptNo } = require('../utils/helpers');
const { calculateFeeSummary } = require('../utils/feeCalculator');

// Configure Multer for Excel file upload (in-memory buffer, max 10MB)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const isXlsxExt = file.originalname.toLowerCase().endsWith('.xlsx') || file.originalname.toLowerCase().endsWith('.xls');
    const isMimeMatch =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream';

    if (isXlsxExt || isMimeMatch) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed.'));
    }
  }
});

/**
 * Standard column headers for mapping and template generation
 */
const EXPECTED_COLUMNS = [
  'Admission No',
  'Student Name',
  'Degree',
  'Specialization',
  'Level',
  'Year of Study',
  'Academic Year',
  'Admission Year',
  'Batch',
  'Group / Category',
  'Father Name',
  'Email',
  'Phone',
  'Gender',
  'Address',
  'Fee Commitment (₹)',
  'Tuition Fee (₹)',
  'UDF Fee (₹)',
  'Exam Fee (₹)',
  'Practical Fee (₹)',
  'TC Amount (₹)',
  'Total Fees (₹)',
  'Total Paid (₹)',
  'Pending Balance (₹)',
  'Payment Method',
  'Last Payment Date'
];

/**
 * Normalize header name for flexible matching (case-insensitive, trims symbols)
 */
function normalizeHeader(h) {
  if (!h) return '';
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/[₹()\/.\-_]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Normalize Year of Study to ERP standard format ('1st Year', '2nd Year', '3rd Year', etc.)
 */
function normalizeYearOfStudy(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^I(\s*Year)?$/i.test(s) || /^1(\s*st)?(\s*Year)?$/i.test(s) || /^(Year\s*1|First\s*Year)$/i.test(s)) return '1st Year';
  if (/^II(\s*Year)?$/i.test(s) || /^2(\s*nd)?(\s*Year)?$/i.test(s) || /^(Year\s*2|Second\s*Year)$/i.test(s)) return '2nd Year';
  if (/^III(\s*Year)?$/i.test(s) || /^3(\s*rd)?(\s*Year)?$/i.test(s) || /^(Year\s*3|Third\s*Year)$/i.test(s)) return '3rd Year';
  if (/^IV(\s*Year)?$/i.test(s) || /^4(\s*th)?(\s*Year)?$/i.test(s) || /^(Year\s*4|Fourth\s*Year)$/i.test(s)) return '4th Year';
  if (/^V(\s*Year)?$/i.test(s) || /^5(\s*th)?(\s*Year)?$/i.test(s) || /^(Year\s*5|Fifth\s*Year)$/i.test(s)) return '5th Year';
  if (/^VI(\s*Year)?$/i.test(s) || /^6(\s*th)?(\s*Year)?$/i.test(s) || /^(Year\s*6|Sixth\s*Year)$/i.test(s)) return '6th Year';
  return s;
}

/**
 * Normalize Payment Mode to match model enum
 */
function normalizePaymentMode(val) {
  if (!val) return 'Cash';
  const s = String(val).trim().toLowerCase();
  if (s.includes('upi')) return 'UPI';
  if (s.includes('card')) return 'Card';
  if (s.includes('transfer') || s.includes('bank') || s.includes('neft') || s.includes('rtgs') || s.includes('imps')) return 'Bank Transfer';
  if (s.includes('cheque') || s.includes('check')) return 'Cheque';
  if (s.includes('cash')) return 'Cash';
  return 'Other';
}

/**
 * Clean and parse cell number safely
 */
function parseNumber(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse an Excel date value safely
 */
function parseExcelDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === 'number') {
    // Excel serial date to JS Date
    const utcDays = Math.floor(val - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    return isNaN(dateInfo) ? null : dateInfo;
  }
  const str = String(val).trim();
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Escape regex special characters
 */
function escapeRegex(s) {
  return s ? String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : '';
}

/**
 * Map raw row object using flexible header matching
 */
function mapRowData(rawRow) {
  const normalizedKeys = {};
  for (const key of Object.keys(rawRow)) {
    normalizedKeys[normalizeHeader(key)] = rawRow[key];
  }

  const getVal = (exactKey, fallbackPatterns = []) => {
    if (rawRow[exactKey] !== undefined && rawRow[exactKey] !== null) {
      return rawRow[exactKey];
    }
    const norm = normalizeHeader(exactKey);
    if (normalizedKeys[norm] !== undefined && normalizedKeys[norm] !== null) {
      return normalizedKeys[norm];
    }
    for (const pat of fallbackPatterns) {
      const pNorm = normalizeHeader(pat);
      if (normalizedKeys[pNorm] !== undefined && normalizedKeys[pNorm] !== null) {
        return normalizedKeys[pNorm];
      }
    }
    return '';
  };

  const admNo = String(getVal('Admission No', ['Admission Number', 'Adm No', 'AdmissionNo', 'Roll No', 'Registration No'])).trim();
  const name = String(getVal('Student Name', ['Name', 'StudentName', 'Candidate Name'])).trim();
  const degree = String(getVal('Degree', ['Course Degree', 'Program'])).trim();
  const specialization = String(getVal('Specialization', ['Branch', 'Group', 'Major'])).trim();
  const level = String(getVal('Level', ['Degree Level', 'UG/PG'])).trim().toUpperCase();
  const rawYear = String(getVal('Year of Study', ['Year', 'Class', 'Current Year', 'Study Year'])).trim();
  const academicYear = String(getVal('Academic Year', ['AcademicYear', 'AY'])).trim();
  const admissionYear = parseNumber(getVal('Admission Year', ['Adm Year', 'Year of Admission']));
  const batch = String(getVal('Batch', ['Batch Years'])).trim();
  const groupCategory = String(getVal('Group / Category', ['Category', 'Group', 'Quota'])).trim();
  const fatherName = String(getVal('Father Name', ['Father', 'Parent Name', 'Guardian Name'])).trim();
  const email = String(getVal('Email', ['Email Address', 'Mail'])).trim().toLowerCase();
  const phone = String(getVal('Phone', ['Phone Number', 'Mobile', 'Contact'])).trim();
  const gender = String(getVal('Gender', ['Sex'])).trim();
  const address = String(getVal('Address', ['Residential Address', 'City'])).trim();

  // Fee related values
  const feeCommitment = parseNumber(getVal('Fee Commitment (₹)', ['Fee Commitment', 'Commitment']));
  const tuitionFee = parseNumber(getVal('Tuition Fee (₹)', ['Tuition Fee', 'Tuition']));
  const udfFee = parseNumber(getVal('UDF Fee (₹)', ['UDF Fee', 'UDF']));
  const examFee = parseNumber(getVal('Exam Fee (₹)', ['Exam Fee', 'Examination Fee']));
  const practicalFee = parseNumber(getVal('Practical Fee (₹)', ['Practical Fee', 'Lab Fee']));
  const tcAmount = parseNumber(getVal('TC Amount (₹)', ['TC Amount', 'TC Fee']));
  const totalFees = parseNumber(getVal('Total Fees (₹)', ['Total Fees', 'Total Fee', 'Total']));
  const totalPaid = parseNumber(getVal('Total Paid (₹)', ['Total Paid', 'Paid Amount', 'Paid']));
  const pendingBalance = parseNumber(getVal('Pending Balance (₹)', ['Pending Balance', 'Balance', 'Pending']));
  const paymentMethod = String(getVal('Payment Method', ['Payment Mode', 'Mode', 'Channel'])).trim();
  const rawPaymentDate = getVal('Last Payment Date', ['Payment Date', 'Date of Payment']);
  const lastPaymentDate = parseExcelDate(rawPaymentDate);

  return {
    admissionNo: admNo,
    name,
    degree,
    specialization,
    level,
    yearOfStudy: normalizeYearOfStudy(rawYear),
    rawYearOfStudy: rawYear,
    academicYear,
    admissionYear: admissionYear || null,
    batch,
    groupCategory,
    fatherName,
    email,
    phone,
    gender,
    address,
    feeCommitment,
    tuitionFee,
    udfFee,
    examFee,
    practicalFee,
    tcAmount,
    totalFees,
    totalPaid,
    pendingBalance,
    paymentMethod,
    lastPaymentDate: lastPaymentDate ? lastPaymentDate.toISOString().split('T')[0] : (rawPaymentDate ? String(rawPaymentDate).trim() : '')
  };
}

/**
 * Validate mapped student row and check against database
 */
function validateRow(row, rowIndex, courses, existingStudentsMap, seenAdmissionNosInFile, feeStructures) {
  const errors = [];
  const warnings = [];

  // Required Field Checks
  if (!row.admissionNo) {
    errors.push('Admission No is required');
  }
  if (!row.name) {
    errors.push('Student Name is required');
  }
  if (!row.degree) {
    errors.push('Degree is required');
  }
  if (!row.specialization) {
    errors.push('Specialization is required');
  }
  if (!row.yearOfStudy) {
    errors.push('Year of Study is required');
  }
  if (!row.academicYear) {
    errors.push('Academic Year is required');
  }

  // File-internal Duplicate Check
  let isDuplicateInFile = false;
  if (row.admissionNo) {
    const lowerAdm = row.admissionNo.toLowerCase();
    if (seenAdmissionNosInFile.has(lowerAdm)) {
      const firstSeen = seenAdmissionNosInFile.get(lowerAdm);
      errors.push(`Duplicate Admission No "${row.admissionNo}" within file (previously seen at Excel row ${firstSeen})`);
      isDuplicateInFile = true;
    } else {
      seenAdmissionNosInFile.set(lowerAdm, rowIndex);
    }
  }

  // Database Duplicate Check
  let isDuplicateInDb = false;
  let existingStudentInfo = null;
  if (row.admissionNo) {
    const existing = existingStudentsMap.get(row.admissionNo.toLowerCase());
    if (existing) {
      errors.push(`Admission No "${row.admissionNo}" already exists in database (${existing.name}, ID: ${existing.studentId})`);
      isDuplicateInDb = true;
      existingStudentInfo = existing;
    }
  }

  // Course Catalog Validation
  let matchedCourse = null;
  if (row.degree && row.specialization) {
    matchedCourse = courses.find(c =>
      c.degree.toLowerCase() === row.degree.toLowerCase() &&
      c.specialization.toLowerCase() === row.specialization.toLowerCase()
    );

    if (!matchedCourse) {
      // Try matching courseName
      const combined = `${row.degree} ${row.specialization}`.toLowerCase();
      matchedCourse = courses.find(c => (c.courseName || '').toLowerCase() === combined);
    }

    if (!matchedCourse) {
      errors.push(`Course "${row.degree} ${row.specialization}" is not in the course catalog`);
    } else {
      // Validate Year of study against course duration
      const duration = matchedCourse.duration || (matchedCourse.level === 'PG' ? 2 : 3);
      const yearMap = { '1st Year': 1, '2nd Year': 2, '3rd Year': 3, '4th Year': 4, '5th Year': 5, '6th Year': 6 };
      const numericYear = yearMap[row.yearOfStudy];
      if (numericYear && numericYear > duration) {
        errors.push(`Invalid Year of Study "${row.yearOfStudy}". ${matchedCourse.degree} ${matchedCourse.specialization} is a ${duration}-year course`);
      }
    }
  }

  // Level Validation
  let derivedLevel = row.level;
  if (matchedCourse) {
    derivedLevel = matchedCourse.level;
  } else if (!derivedLevel) {
    derivedLevel = (row.degree.toLowerCase().includes('m.sc') || row.degree.toLowerCase().includes('mba') || row.degree.toLowerCase().includes('mca')) ? 'PG' : 'UG';
  }

  // Email format validation
  if (row.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(row.email)) {
      errors.push(`Invalid email format: "${row.email}"`);
    }
  }

  // Phone format validation
  if (row.phone) {
    const digitsOnly = row.phone.replace(/[^0-9]/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      errors.push(`Invalid phone number: "${row.phone}"`);
    }
  }

  // Fee Negative Amount Validations
  const feeFields = [
    { label: 'Fee Commitment', val: row.feeCommitment },
    { label: 'Tuition Fee', val: row.tuitionFee },
    { label: 'UDF Fee', val: row.udfFee },
    { label: 'Exam Fee', val: row.examFee },
    { label: 'Practical Fee', val: row.practicalFee },
    { label: 'TC Amount', val: row.tcAmount },
    { label: 'Total Fees', val: row.totalFees },
    { label: 'Total Paid', val: row.totalPaid },
    { label: 'Pending Balance', val: row.pendingBalance }
  ];
  for (const ff of feeFields) {
    if (ff.val < 0) {
      errors.push(`${ff.label} cannot be negative (${ff.val})`);
    }
  }

  // Discrepancy & Fee Structure Checks
  const excelComponentSum = row.feeCommitment + row.tuitionFee + row.udfFee + row.examFee + row.practicalFee + row.tcAmount;
  if (row.totalFees > 0 && excelComponentSum > 0 && excelComponentSum !== row.totalFees) {
    warnings.push(`Excel row components sum (₹${excelComponentSum.toLocaleString('en-IN')}) does not match Total Fees column (₹${row.totalFees.toLocaleString('en-IN')})`);
  }

  // Compare with MongoDB Fee Structure
  let backendStructureTotal = 0;
  let matchingStructures = [];
  const unconfiguredCategories = [];

  if (row.degree && row.specialization && row.yearOfStudy && row.academicYear) {
    const courseDisplayName = matchedCourse ? matchedCourse.courseName : `${row.degree} ${row.specialization}`;
    matchingStructures = feeStructures.filter(fs => {
      const courseMatch =
        fs.course.toLowerCase() === courseDisplayName.toLowerCase() ||
        fs.course.toLowerCase() === `${row.degree} ${row.specialization}`.toLowerCase() ||
        fs.course.toLowerCase() === row.degree.toLowerCase();
      const yearMatch = fs.year.toLowerCase() === row.yearOfStudy.toLowerCase();
      const ayMatch = fs.academicYear === row.academicYear;
      return courseMatch && yearMatch && ayMatch;
    });

    backendStructureTotal = matchingStructures.reduce((sum, fs) => sum + (fs.amount || 0), 0);

    if (matchingStructures.length === 0) {
      warnings.push(`No active Fee Structure found in MongoDB for "${courseDisplayName}" (${row.yearOfStudy}, ${row.academicYear}). Fee demand will require manual configuration.`);
    } else {
      // Check if Excel has fee categories that are missing from the structure
      const configuredCatNames = matchingStructures.map(s => s.category.toLowerCase());
      if (row.tuitionFee > 0 && !configuredCatNames.some(c => c.includes('tuition'))) unconfiguredCategories.push('Tuition Fee');
      if (row.udfFee > 0 && !configuredCatNames.some(c => c.includes('udf'))) unconfiguredCategories.push('UDF Fee');
      if (row.examFee > 0 && !configuredCatNames.some(c => c.includes('exam'))) unconfiguredCategories.push('Exam Fee');
      if (row.practicalFee > 0 && !configuredCatNames.some(c => c.includes('practical') || c.includes('lab'))) unconfiguredCategories.push('Practical Fee');

      if (unconfiguredCategories.length > 0) {
        warnings.push(`Unconfigured in MongoDB Fee Structure: ${unconfiguredCategories.join(', ')}`);
      }

      if (row.totalFees > 0 && backendStructureTotal > 0 && row.totalFees !== backendStructureTotal) {
        warnings.push(`Backend Fee Structure total (₹${backendStructureTotal.toLocaleString('en-IN')}) differs from Excel Total Fees (₹${row.totalFees.toLocaleString('en-IN')})`);
      }
    }
  }

  // Determine overall row status
  let status = 'valid';
  if (errors.length > 0) {
    status = (isDuplicateInFile || isDuplicateInDb) ? 'duplicate' : 'invalid';
  }

  return {
    rowIndex,
    data: {
      ...row,
      level: derivedLevel
    },
    matchedCourse: matchedCourse ? {
      _id: matchedCourse._id,
      courseId: matchedCourse.courseId,
      courseName: matchedCourse.courseName,
      duration: matchedCourse.duration,
      level: matchedCourse.level
    } : null,
    status,
    isDuplicate: isDuplicateInFile || isDuplicateInDb,
    existingStudentInfo,
    errors,
    warnings,
    feeComparison: {
      excelTotalFees: row.totalFees,
      excelComponentSum,
      backendStructureTotal,
      matchingStructuresCount: matchingStructures.length,
      unconfiguredCategories,
      excelTotalPaid: row.totalPaid,
      excelPendingBalance: row.pendingBalance
    }
  };
}

// ==================== EXPORTED CONTROLLER METHODS ====================

/**
 * @desc    Download standard Excel template with all 26 columns
 * @route   GET /api/imports/template
 * @access  Admin Only
 */
exports.getSampleTemplate = async (req, res) => {
  try {
    const wb = XLSX.utils.book_new();

    const sampleRows = [
      {
        'Admission No': 'BCOM2024001',
        'Student Name': 'Aarav Kumar',
        'Degree': 'B.Com',
        'Specialization': 'Computer Application',
        'Level': 'UG',
        'Year of Study': '3rd Year',
        'Academic Year': '2026-27',
        'Admission Year': 2024,
        'Batch': '2024-27',
        'Group / Category': 'General',
        'Father Name': 'Ramakrishna Sharma',
        'Email': 'aarav.kumar@example.com',
        'Phone': '9876500001',
        'Gender': 'Male',
        'Address': 'Srikakulam, Andhra Pradesh',
        'Fee Commitment (₹)': 0,
        'Tuition Fee (₹)': 47000,
        'UDF Fee (₹)': 750,
        'Exam Fee (₹)': 1200,
        'Practical Fee (₹)': 1000,
        'TC Amount (₹)': 0,
        'Total Fees (₹)': 49950,
        'Total Paid (₹)': 25000,
        'Pending Balance (₹)': 24950,
        'Payment Method': 'Card',
        'Last Payment Date': '2026-09-20'
      },
      {
        'Admission No': 'MSC2026002',
        'Student Name': 'Ananya Chowdary',
        'Degree': 'M.Sc',
        'Specialization': 'Organic Chemistry',
        'Level': 'PG',
        'Year of Study': '1st Year',
        'Academic Year': '2026-27',
        'Admission Year': 2026,
        'Batch': '2026-28',
        'Group / Category': 'General',
        'Father Name': 'Suresh Reddy',
        'Email': 'ananya.c@example.com',
        'Phone': '9876500002',
        'Gender': 'Female',
        'Address': 'Vizianagaram, Andhra Pradesh',
        'Fee Commitment (₹)': 10000,
        'Tuition Fee (₹)': 60000,
        'UDF Fee (₹)': 1000,
        'Exam Fee (₹)': 1200,
        'Practical Fee (₹)': 750,
        'TC Amount (₹)': 0,
        'Total Fees (₹)': 72950,
        'Total Paid (₹)': 0,
        'Pending Balance (₹)': 72950,
        'Payment Method': '',
        'Last Payment Date': ''
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: EXPECTED_COLUMNS });

    // Set column widths for readability
    const colWidths = EXPECTED_COLUMNS.map(col => ({ wch: Math.max(col.length + 3, 14) }));
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Students & Fees');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="college_admin_student_import_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Download template error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate Excel template' });
  }
};

/**
 * @desc    Upload & preview Excel records without committing to database
 * @route   POST /api/imports/preview
 * @access  Admin Only
 */
exports.previewImport = [
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Please select an Excel (.xlsx) file to upload' });
      }

      // Safe parse using XLSX
      let wb;
      try {
        wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          message: 'Unable to parse workbook. Please ensure the file is a valid Excel (.xlsx) document.'
        });
      }

      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        return res.status(400).json({ success: false, message: 'The uploaded Excel file contains no worksheets.' });
      }

      const firstSheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      if (rawRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'The worksheet is empty. Please ensure rows with data exist below the header row.'
        });
      }

      // Fetch active catalog data from MongoDB
      const [courses, existingStudents, feeStructures] = await Promise.all([
        Course.find({ status: 'active' }),
        Student.find({}, 'admissionNo studentId name course currentYear'),
        FeeStructure.find({ status: 'active' })
      ]);

      const existingStudentsMap = new Map();
      existingStudents.forEach(s => {
        if (s.admissionNo) {
          existingStudentsMap.set(s.admissionNo.toLowerCase(), {
            studentId: s.studentId,
            admissionNo: s.admissionNo,
            name: s.name,
            course: s.course,
            currentYear: s.currentYear
          });
        }
      });

      const seenAdmissionNosInFile = new Map();
      const records = [];

      let validCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;
      let discrepancyCount = 0;

      for (let i = 0; i < rawRows.length; i++) {
        const rawRow = rawRows[i];
        const rowIndex = i + 2; // 1-indexed, header is row 1
        const mapped = mapRowData(rawRow);
        const validated = validateRow(mapped, rowIndex, courses, existingStudentsMap, seenAdmissionNosInFile, feeStructures);

        if (validated.status === 'valid') validCount++;
        else if (validated.status === 'duplicate') duplicateCount++;
        else invalidCount++;

        if (validated.warnings.length > 0) discrepancyCount++;

        records.push(validated);
      }

      res.json({
        success: true,
        data: {
          filename: req.file.originalname,
          fileSize: req.file.size,
          sheetName: firstSheetName,
          totalRows: rawRows.length,
          validCount,
          duplicateCount,
          invalidCount,
          discrepancyCount,
          records
        }
      });
    } catch (error) {
      console.error('Preview import error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error while previewing Excel file'
      });
    }
  }
];

/**
 * @desc    Confirm and execute student import into MongoDB
 * @route   POST /api/imports/confirm
 * @access  Admin Only
 */
exports.confirmImport = [
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Please attach the Excel file to confirm import' });
      }

      const mode = (req.body.mode || 'valid_only').toLowerCase(); // 'valid_only' | 'all_or_nothing'
      const importHistoricalPayments = req.body.importPayments === 'true' || req.body.importPayments === true;

      // Safe parse
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      if (rawRows.length === 0) {
        return res.status(400).json({ success: false, message: 'No student data rows found in uploaded file' });
      }

      // Fetch fresh database context
      const [courses, existingStudents, feeStructures] = await Promise.all([
        Course.find({ status: 'active' }),
        Student.find({}, 'admissionNo studentId name course currentYear'),
        FeeStructure.find({ status: 'active' })
      ]);

      const existingStudentsMap = new Map();
      existingStudents.forEach(s => {
        if (s.admissionNo) {
          existingStudentsMap.set(s.admissionNo.toLowerCase(), {
            studentId: s.studentId,
            admissionNo: s.admissionNo,
            name: s.name
          });
        }
      });

      const seenAdmissionNosInFile = new Map();
      const validatedRows = [];

      let hasValidationFailure = false;
      let invalidCount = 0;
      let duplicateCount = 0;

      for (let i = 0; i < rawRows.length; i++) {
        const mapped = mapRowData(rawRows[i]);
        const validated = validateRow(mapped, i + 2, courses, existingStudentsMap, seenAdmissionNosInFile, feeStructures);

        if (validated.status === 'invalid') {
          hasValidationFailure = true;
          invalidCount++;
        } else if (validated.status === 'duplicate') {
          hasValidationFailure = true;
          duplicateCount++;
        }
        validatedRows.push(validated);
      }

      // Enforce All-or-Nothing check
      if (mode === 'all_or_nothing' && hasValidationFailure) {
        return res.status(400).json({
          success: false,
          message: `All-or-Nothing import rejected: Found ${invalidCount} invalid row(s) and ${duplicateCount} duplicate row(s). No records were imported into MongoDB.`,
          data: {
            mode,
            totalRows: rawRows.length,
            invalidCount,
            duplicateCount,
            failedRecords: validatedRows.filter(r => r.status !== 'valid')
          }
        });
      }

      // Filter rows to import
      const rowsToImport = validatedRows.filter(r => r.status === 'valid');
      if (rowsToImport.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid records available to import. All rows are either duplicates or invalid.',
          data: {
            totalRows: rawRows.length,
            duplicateCount,
            invalidCount
          }
        });
      }

      const insertedStudents = [];
      const createdDemands = [];
      const createdPayments = [];
      const skippedDuplicates = validatedRows.filter(r => r.status === 'duplicate');
      const skippedInvalids = validatedRows.filter(r => r.status === 'invalid');

      // Process insertion sequentially to ensure unique sequential IDs and consistency
      for (const item of rowsToImport) {
        const row = item.data;
        const matchedCourse = item.matchedCourse;

        const duration = matchedCourse ? matchedCourse.duration : (row.degree.toLowerCase().includes('m.sc') ? 2 : 3);
        const derivedLevel = matchedCourse ? matchedCourse.level : (row.degree.toLowerCase().includes('m.sc') ? 'PG' : 'UG');
        const courseDisplayName = matchedCourse ? matchedCourse.courseName : `${row.degree} ${row.specialization}`;

        // Compute batch years
        let startYear = row.admissionYear;
        if (!startYear && row.admissionNo) {
          const match = row.admissionNo.match(/\d{4}/);
          if (match) startYear = parseInt(match[0], 10);
        }
        if (!startYear && row.academicYear) {
          const match = row.academicYear.match(/\d{4}/);
          if (match) startYear = parseInt(match[0], 10);
        }
        if (!startYear) startYear = new Date().getFullYear();

        const batchStartYear = startYear;
        const batchEndYear = startYear + duration;
        const batch = row.batch || `${batchStartYear}-${batchEndYear}`;

        // Generate unique student ID
        const studentId = await generateId(Student, 'STU', 'studentId');

        // Create student document
        const newStudent = await Student.create({
          studentId,
          admissionNo: row.admissionNo,
          name: row.name,
          degree: row.degree,
          specialization: row.specialization,
          courseId: matchedCourse ? matchedCourse._id : undefined,
          duration,
          course: courseDisplayName,
          level: derivedLevel,
          currentYear: row.yearOfStudy,
          currentAcademicYear: row.academicYear,
          batchStartYear,
          batchEndYear,
          batch,
          enrollmentHistory: [{
            year: row.yearOfStudy,
            academicYear: row.academicYear,
            promotedAt: new Date()
          }],
          email: row.email || undefined,
          phone: row.phone || undefined,
          fatherName: row.fatherName || undefined,
          address: row.address || undefined,
          gender: row.gender ? (row.gender.toLowerCase().startsWith('f') ? 'Female' : 'Male') : undefined,
          status: 'Active'
        });

        insertedStudents.push(newStudent);

        // ==================== FEE ASSESSMENT (Section 5) ====================
        // Find matching active FeeStructure in MongoDB
        const matchingStructures = feeStructures.filter(fs => {
          const courseMatch =
            fs.course.toLowerCase() === courseDisplayName.toLowerCase() ||
            fs.course.toLowerCase() === `${row.degree} ${row.specialization}`.toLowerCase() ||
            fs.course.toLowerCase() === row.degree.toLowerCase();
          const yearMatch = fs.year.toLowerCase() === row.yearOfStudy.toLowerCase();
          const ayMatch = fs.academicYear === row.academicYear;
          return courseMatch && yearMatch && ayMatch;
        });

        if (matchingStructures.length > 0) {
          const now = new Date();
          const categories = matchingStructures.map(fs => ({
            category: fs.category,
            amount: fs.amount,
            frequency: fs.frequency || 'ANNUAL',
            semester: fs.semester || null,
            activationDate: fs.activationDate || null,
            dueDate: fs.dueDate || null,
            status: (fs.activationDate && new Date(fs.activationDate) > now) ? 'upcoming' : 'active'
          }));

          const totalDemand = categories.reduce((sum, c) => sum + c.amount, 0);

          const demand = await FeeDemand.create({
            student: newStudent._id,
            studentId: newStudent.studentId,
            academicYear: row.academicYear,
            year: row.yearOfStudy,
            course: courseDisplayName,
            level: derivedLevel,
            categories,
            totalDemand,
            createdBy: req.user._id
          });

          createdDemands.push(demand);
        }

        // ==================== OPTIONAL HISTORICAL PAYMENTS (Section 6) ====================
        // Only if explicitly confirmed by Admin!
        if (importHistoricalPayments && row.totalPaid > 0) {
          const receiptNo = await generateReceiptNo();
          const pDate = row.lastPaymentDate ? new Date(row.lastPaymentDate) : new Date();

          const payment = await Payment.create({
            receiptNo,
            student: newStudent._id,
            studentId: newStudent.studentId,
            academicYear: row.academicYear,
            year: row.yearOfStudy,
            allocations: [{
              academicYear: row.academicYear,
              year: row.yearOfStudy,
              category: 'Tuition Fee',
              amount: row.totalPaid
            }],
            amountPaid: row.totalPaid,
            paymentDate: isNaN(pDate.getTime()) ? new Date() : pDate,
            paymentMode: normalizePaymentMode(row.paymentMethod),
            remarks: `Imported historical payment from ${req.file.originalname}`,
            enteredBy: req.user._id,
            enteredByName: req.user.name,
            status: 'completed',
            locked: true,
            lockedAt: new Date()
          });

          createdPayments.push(payment);
        }
      }

      // ==================== AUDIT LOGGING (Section 7) ====================
      await createAuditLog({
        user: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        action: 'Excel Student Import',
        entity: 'Student',
        entityId: `IMPORT-${Date.now()}`,
        description: `Imported ${insertedStudents.length} student(s) from "${req.file.originalname}". Skipped: ${skippedDuplicates.length} duplicate(s), ${skippedInvalids.length} invalid. Mode: ${mode}. Fee Demands: ${createdDemands.length}. Historical Payments: ${createdPayments.length}.`,
        newValue: {
          originalFilename: req.file.originalname,
          mode,
          totalRows: rawRows.length,
          insertedCount: insertedStudents.length,
          duplicateCount: skippedDuplicates.length,
          invalidCount: skippedInvalids.length,
          feeDemandsCreated: createdDemands.length,
          paymentsCreated: createdPayments.length
        },
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: `Successfully imported ${insertedStudents.length} student records from ${req.file.originalname}`,
        data: {
          filename: req.file.originalname,
          mode,
          totalRows: rawRows.length,
          insertedCount: insertedStudents.length,
          duplicateCount: skippedDuplicates.length,
          invalidCount: skippedInvalids.length,
          feeDemandsCreated: createdDemands.length,
          paymentsCreated: createdPayments.length,
          insertedStudents: insertedStudents.map(s => ({
            _id: s._id,
            studentId: s.studentId,
            admissionNo: s.admissionNo,
            name: s.name,
            course: s.course,
            level: s.level,
            currentYear: s.currentYear,
            currentAcademicYear: s.currentAcademicYear
          })),
          duplicatesSummary: skippedDuplicates.map(d => ({
            rowIndex: d.rowIndex,
            admissionNo: d.data.admissionNo,
            name: d.data.name,
            reason: d.errors.join('; ')
          })),
          invalidsSummary: skippedInvalids.map(inv => ({
            rowIndex: inv.rowIndex,
            admissionNo: inv.data.admissionNo,
            name: inv.data.name,
            reason: inv.errors.join('; ')
          }))
        }
      });
    } catch (error) {
      console.error('Confirm import error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Server error while executing student import'
      });
    }
  }
];

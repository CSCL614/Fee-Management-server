const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

async function runVerification() {
  console.log('=== STARTING PENDING FEE EXCEL FILTER CONFIGURATION VERIFICATION ===\n');

  await mongoose.connect('mongodb://127.0.0.1:27017/college_fee_mgmt');
  const exportCtrl = require('../controllers/exportController');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // TEST 1: Default Filter Configuration Preview
  console.log('--- TEST 1: Default Filter Configuration (Batch: 2024–2027, AY: 2026-27, StudyYear: All, Course: All) ---');
  let previewData1 = null;
  const mockRes1 = {
    json: (res) => { previewData1 = res.data; }
  };
  await exportCtrl.previewPendingFeesExport({
    query: {
      batch: '2024–2027',
      academicYear: '2026-27',
      course: 'All',
      studyYear: 'All'
    }
  }, mockRes1);

  assert(previewData1 !== null, 'Preview API returned valid data');
  assert(previewData1.count === 2, `Preview returned exactly 2 matching students (got ${previewData1.count})`);
  assert(previewData1.sampleStudents.length === 2, `Sample students length is 2 (got ${previewData1.sampleStudents.length})`);
  
  const aditya = previewData1.sampleStudents.find(s => s.name === 'Aditya Verma');
  assert(aditya !== undefined, 'Aditya Verma is present in matching students');
  assert(aditya.batch === '2024–2027', `Aditya batch matches 2024–2027 (got ${aditya.batch})`);
  assert(aditya.academicYear === '2026-27', `Aditya academic year is 2026-27 (got ${aditya.academicYear})`);
  assert(aditya.totalAssessed === 37000, `Aditya 2026-27 assessed fee is ₹37,000 (got ${aditya.totalAssessed})`);
  assert(aditya.totalPaid === 10000, `Aditya 2026-27 paid fee is ₹10,000 (got ${aditya.totalPaid})`);
  assert(aditya.remainingBalance === 27000, `Aditya 2026-27 remaining balance is ₹27,000 (got ${aditya.remainingBalance}) - Not mixed with older years!`);

  const sravan = previewData1.sampleStudents.find(s => s.name === 'Sravan Kumar');
  assert(sravan !== undefined, 'Sravan Kumar is present in matching students');
  assert(sravan.remainingBalance === 37000, `Sravan remaining balance is ₹37,000 (got ${sravan.remainingBalance})`);

  // TEST 2: Hyphen variation normalization (2024-2027 with standard hyphen vs 2024–2027 en-dash)
  console.log('\n--- TEST 2: Hyphen & Dash Normalization ---');
  let previewDataHyphen = null;
  await exportCtrl.previewPendingFeesExport({
    query: {
      batch: '2024-2027', // standard hyphen
      academicYear: '2026–27', // en-dash
      course: 'All',
      studyYear: 'All'
    }
  }, { json: (res) => { previewDataHyphen = res.data; } });
  assert(previewDataHyphen.count === 2, `Normalized hyphen query returned exactly 2 matching students (got ${previewDataHyphen.count})`);

  // TEST 3: Combined Strict AND Logic (Course Filter)
  console.log('\n--- TEST 3: Combined Strict AND Logic (Course Specific) ---');
  let previewCourseCS = null;
  await exportCtrl.previewPendingFeesExport({
    query: {
      batch: '2024–2027',
      academicYear: '2026-27',
      course: 'B.Sc Computer Science',
      studyYear: 'All'
    }
  }, { json: (res) => { previewCourseCS = res.data; } });
  assert(previewCourseCS.count === 2, `Course B.Sc Computer Science matched 2 students (got ${previewCourseCS.count})`);

  let previewCourseChem = null;
  await exportCtrl.previewPendingFeesExport({
    query: {
      batch: '2024–2027',
      academicYear: '2026-27',
      course: 'B.Sc Chemistry',
      studyYear: 'All'
    }
  }, { json: (res) => { previewCourseChem = res.data; } });
  assert(previewCourseChem.count === 0, `Course B.Sc Chemistry in Batch 2024–2027 correctly matched 0 students (got ${previewCourseChem.count})`);

  // TEST 4: Combined Strict AND Logic (Study Year Filter)
  console.log('\n--- TEST 4: Combined Strict AND Logic (Study Year Specific) ---');
  let previewYear3 = null;
  await exportCtrl.previewPendingFeesExport({
    query: {
      batch: '2024–2027',
      academicYear: '2026-27',
      course: 'All',
      studyYear: '3rd Year'
    }
  }, { json: (res) => { previewYear3 = res.data; } });
  assert(previewYear3.count === 2, `Study Year 3rd Year matched 2 students (got ${previewYear3.count})`);

  let previewYear1 = null;
  await exportCtrl.previewPendingFeesExport({
    query: {
      batch: '2024–2027',
      academicYear: '2026-27',
      course: 'All',
      studyYear: '1st Year'
    }
  }, { json: (res) => { previewYear1 = res.data; } });
  assert(previewYear1.count === 0, `Study Year 1st Year in Batch 2024–2027 correctly matched 0 students (got ${previewYear1.count})`);

  // TEST 5: Excel Generation & 100% Accuracy Verification
  console.log('\n--- TEST 5: Excel Generation & 100% Parity with Preview ---');
  const excelChunks = [];
  const mockExcelRes = {
    setHeader: () => {},
    write: (chunk) => excelChunks.push(chunk),
    end: () => {}
  };
  await exportCtrl.exportPendingFeesExcel({
    query: {
      batch: '2024–2027',
      academicYear: '2026-27',
      course: 'All',
      studyYear: 'All'
    },
    user: { name: 'Super Admin' }
  }, mockExcelRes);

  const excelBuffer = Buffer.concat(excelChunks);
  assert(excelBuffer.length > 5000, `Generated valid Excel workbook (${excelBuffer.length} bytes)`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(excelBuffer);
  const sheet = wb.getWorksheet('Pending_Fees_Register');
  assert(sheet !== undefined, 'Sheet Pending_Fees_Register exists');
  
  // Header row 5
  const headerCols = sheet.getRow(5).values.filter(Boolean);
  assert(headerCols.includes('Roll Number'), 'Header includes Roll Number');
  assert(headerCols.includes('Student Name'), 'Header includes Student Name');
  assert(headerCols.includes('Tuition Fee'), 'Header includes Tuition Fee (one column)');
  assert(headerCols.includes('Lab Fee'), 'Header includes Lab Fee (one column)');
  assert(headerCols.includes('Total Assessed Fee'), 'Header includes Total Assessed Fee');
  assert(headerCols.includes('Total Paid'), 'Header includes Total Paid');
  assert(headerCols.includes('Remaining Balance'), 'Header includes Remaining Balance');

  // Verify Rows 6 and 7 (2 students) and Row 8 (Grand Total)
  const row6 = sheet.getRow(6).values.filter(Boolean);
  const row7 = sheet.getRow(7).values.filter(Boolean);
  const row8 = sheet.getRow(8).values.filter(Boolean);
  
  assert(row6[0] === 'BSC2024051' && row6[1] === 'Aditya Verma', `Row 6 is Aditya Verma (got ${row6[0]} ${row6[1]})`);
  assert(row7[0] === 'BSC2024052' && row7[1] === 'Sravan Kumar', `Row 7 is Sravan Kumar (got ${row7[0]} ${row7[1]})`);
  assert(String(row8[0]).includes('GRAND TOTAL (2 RECORDS)'), `Row 8 is Grand Total for 2 records (got ${row8[0]})`);

  // TEST 6: Empty Results Handling
  console.log('\n--- TEST 6: Empty Filter Combination Workbook Handling ---');
  const emptyChunks = [];
  await exportCtrl.exportPendingFeesExcel({
    query: {
      batch: '2024–2027',
      academicYear: '2026-27',
      course: 'B.Sc Chemistry', // 0 students
      studyYear: 'All'
    },
    user: { name: 'Super Admin' }
  }, {
    setHeader: () => {},
    write: (chunk) => emptyChunks.push(chunk),
    end: () => {}
  });

  const emptyWb = new ExcelJS.Workbook();
  await emptyWb.xlsx.load(Buffer.concat(emptyChunks));
  const emptySheet = emptyWb.getWorksheet('Pending_Fees_Register');
  assert(emptySheet !== undefined, 'Empty sheet created cleanly');
  const emptyNotice = emptySheet.getCell(6, 1).value;
  assert(emptyNotice.includes('No students match'), `Row 6 contains empty notice: "${emptyNotice}"`);

  console.log(`\n========================================`);
  console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} tests successful)`);
  console.log(`========================================\n`);

  await mongoose.disconnect();
}

runVerification().catch(err => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});


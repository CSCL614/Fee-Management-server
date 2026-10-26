const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE_URL = 'http://127.0.0.1:5000/api';

async function runTests() {
  console.log('=====================================================');
  console.log('   COLLEGE FEE MANAGEMENT SYSTEM VERIFICATION SUITE   ');
  console.log('=====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = '') {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} - ${detail}`);
      failed++;
    }
  }

  // 1. Logins
  console.log('--- Step 1: Authentication & Role Check ---');
  const adminLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const adminLogin = await adminLoginRes.json();
  const adminToken = adminLogin.data?.accessToken;
  assert(adminLogin.success && adminToken, 'Admin authentication successful');

  const accLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'suresh', password: 'acc123' })
  });
  const accLogin = await accLoginRes.json();
  const accToken = accLogin.data?.accessToken;
  assert(accLogin.success && accToken, 'Accountant authentication successful');

  // 2. Role-Based Permissions (Requirement 6)
  console.log('\n--- Step 2: Fee Structure Role Permissions (Requirement 6) ---');
  // Accountant read-only
  const accGetStructRes = await fetch(`${BASE_URL}/fees/structures`, {
    headers: { 'Authorization': `Bearer ${accToken}` }
  });
  assert(accGetStructRes.status === 200, 'Accountant can read fee structures (200 OK)');

  // Accountant blocked from mutation
  const accPostStructRes = await fetch(`${BASE_URL}/fees/structures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accToken}` },
    body: JSON.stringify({
      course: 'B.Com Computer Application',
      academicYear: '2026-27',
      quota: 'general',
      terms: [{ termName: 'Annual', feeCategories: [] }]
    })
  });
  assert(accPostStructRes.status === 403, 'Accountant POST /fees/structures blocked with HTTP 403 Forbidden');

  const accPutStructRes = await fetch(`${BASE_URL}/fees/structures/650000000000000000000001`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accToken}` },
    body: JSON.stringify({ quota: 'management' })
  });
  assert(accPutStructRes.status === 403, 'Accountant PUT /fees/structures/:id blocked with HTTP 403 Forbidden');

  const accDelStructRes = await fetch(`${BASE_URL}/fees/structures/650000000000000000000001`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accToken}` }
  });
  assert(accDelStructRes.status === 403, 'Accountant DELETE /fees/structures/:id blocked with HTTP 403 Forbidden');

  // Admin can perform mutations
  const adminPostStructRes = await fetch(`${BASE_URL}/fees/structures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      course: 'B.Com Computer Application',
      year: '1st Year',
      academicYear: '2026-27',
      category: 'Sports Fee',
      amount: 2500,
      frequency: 'ANNUAL'
    })
  });
  const adminPostData = await adminPostStructRes.json();
  const createdStruct = adminPostData.data?.[0] || adminPostData.data;
  const createdStructId = createdStruct?._id;
  assert(adminPostStructRes.status === 201 && createdStructId, 'Admin can CREATE fee structure (HTTP 201 Created)');

  if (createdStructId) {
    const adminPutRes = await fetch(`${BASE_URL}/fees/structures/${createdStructId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'inactive' })
    });
    assert(adminPutRes.status === 200, 'Admin can EDIT fee structure (HTTP 200 OK)');

    const adminDelRes = await fetch(`${BASE_URL}/fees/structures/${createdStructId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminDelRes.status === 200, 'Admin can DELETE fee structure (HTTP 200 OK)');
  }

  // 3. Monthly Collection (Requirement 1)
  console.log('\n--- Step 3: Monthly Collection API (Requirement 1) ---');
  const dashRes = await fetch(`${BASE_URL}/reports/dashboard`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const dashData = await dashRes.json();
  const mc = dashData.data?.monthlyCollection;
  assert(mc && typeof mc.total === 'number', 'Dashboard returns monthlyCollection object');
  assert(mc.label === 'October 2026' || mc.monthName === 'October', `Monthly collection label is dynamic ("${mc.label}")`);
  assert(mc.total >= 0, `Monthly collection total is ₹${mc.total} (${mc.count} valid receipts)`);

  const monthlyDedicatedRes = await fetch(`${BASE_URL}/payments/monthly`, {
    headers: { 'Authorization': `Bearer ${accToken}` }
  });
  const monthlyDedicated = await monthlyDedicatedRes.json();
  assert(monthlyDedicated.success && monthlyDedicated.data.total === mc.total, 'Dedicated /payments/monthly matches dashboard calculation');

  // 4. Yearly Fee Inflow (Requirement 2)
  console.log('\n--- Step 4: Yearly Fee Inflow API (Requirement 2) ---');
  const inflowRes = await fetch(`${BASE_URL}/reports/yearly-inflow?year=2026`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const inflowData = await inflowRes.json();
  assert(inflowData.success, 'GET /reports/yearly-inflow returns success');
  const months = inflowData.data?.monthlyData || [];
  assert(months.length === 12, 'Yearly inflow returns exactly 12 months (Jan to Dec)');
  assert(months[0].month === 'Jan' && months[11].month === 'Dec', 'Months are ordered Jan to Dec');
  const octMonth = months.find(m => m.month === 'Oct');
  assert(octMonth && octMonth.amount === mc.total, `October inflow matches October collection: ₹${octMonth.amount}`);
  assert(months.every(m => typeof m.amount === 'number' && typeof m.count === 'number'), 'All months have amount and count');
  assert(Array.isArray(inflowData.data?.availableYears) && inflowData.data.availableYears.includes(2026), 'Dynamic year selector has available years');

  // 5. Total Fee Amount to Be Collected (Requirement 4)
  console.log('\n--- Step 5: Dashboard Assessed Fee Metric (Requirement 4) ---');
  assert(dashData.data?.totalFee > 0, `Total Fee Amount to Be Collected: ₹${dashData.data?.totalFee}`);
  assert(dashData.data?.totalFee - dashData.data?.totalCollected === dashData.data?.totalPending, 'Total Fee - Total Collected = Total Pending matches exactly');

  // 6. Three Side-by-Side Pie Charts Analytics (Requirement 5)
  console.log('\n--- Step 6: Three Side-by-Side Fee Analytics Pie Charts (Requirement 5) ---');
  const analyticsRes = await fetch(`${BASE_URL}/reports/fee-analytics`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const analytics = await analyticsRes.json();
  assert(analytics.success, 'GET /reports/fee-analytics returns success');
  assert(Array.isArray(analytics.data?.feeToBeCollected) && analytics.data.feeToBeCollected.length > 0, 'Pie 1: feeToBeCollected has categories with percentages');
  assert(Array.isArray(analytics.data?.feePaid), 'Pie 2: feePaid has allocated categories');
  assert(Array.isArray(analytics.data?.feePending) && analytics.data.feePending.length > 0, 'Pie 3: feePending has outstanding category balances');
  assert(analytics.data?.totals?.totalDemand === dashData.data.totalFee, 'Fee to Be Collected total equals Total Fee Demand');
  
  // Test Filter on Pie Charts
  const filteredAnalyticsRes = await fetch(`${BASE_URL}/reports/fee-analytics?course=B.Com%20Computer%20Application`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const filteredAnalytics = await filteredAnalyticsRes.json();
  assert(filteredAnalytics.success, 'Filtered fee analytics returns success');
  assert(filteredAnalytics.data?.totals?.totalDemand < analytics.data.totals.totalDemand, 'Filtering by Course dynamically isolates course fee distribution');

  // 7. Student Payment Recording with Fee Category (Requirement 3)
  console.log('\n--- Step 7: Payment Recording with Fee Category & Ledger Updates (Requirement 3) ---');
  // Lookup a student
  const searchRes = await fetch(`${BASE_URL}/students/search?q=STU-0001`, {
    headers: { 'Authorization': `Bearer ${accToken}` }
  });
  const searchData = await searchRes.json();
  const testStudent = searchData.data?.[0];
  assert(testStudent, `Found target student: ${testStudent?.name} (${testStudent?.studentId})`);

  // Get student fee summary
  const feeSumRes = await fetch(`${BASE_URL}/students/${testStudent.studentId}/fee-summary`, {
    headers: { 'Authorization': `Bearer ${accToken}` }
  });
  const feeSum = await feeSumRes.json();
  const initialSummary = feeSum.data?.currentYearSummary;
  const initialTuition = initialSummary?.categories?.find(c => c.category === 'Tuition Fee');
  assert(initialTuition, `Student has Tuition Fee demand. Remaining: ₹${initialTuition?.remainingAmount}`);

  // Test validation: mismatched allocation
  const invalidAllocRes = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accToken}` },
    body: JSON.stringify({
      studentId: testStudent.studentId,
      academicYear: '2026-27',
      amountPaid: 5000,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMode: 'Cash',
      feeCategory: 'Tuition Fee',
      allocations: [{ category: 'Tuition Fee', amount: 4000, academicYear: '2026-27' }]
    })
  });
  assert(invalidAllocRes.status === 400, 'Mismatched allocations sum rejected with HTTP 400 Bad Request');

  // Record valid partial payment of ₹5,000 toward Tuition Fee
  const validPayRes = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accToken}` },
    body: JSON.stringify({
      studentId: testStudent.studentId,
      academicYear: '2026-27',
      amountPaid: 5000,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMode: 'Cash',
      feeCategory: 'Tuition Fee',
      allocations: [{ category: 'Tuition Fee', amount: 5000, academicYear: '2026-27' }],
      remarks: 'Automated test partial Tuition Fee payment'
    })
  });
  const validPayData = await validPayRes.json();
  assert(validPayRes.status === 201 && validPayData.success, 'Valid ₹5,000 Tuition Fee payment recorded successfully');
  const paymentReceipt = validPayData.data?.payment?.receiptNo;
  assert(paymentReceipt, `Receipt voucher issued: ${paymentReceipt}`);

  // Check updated student fee summary and category balance
  const postPaySumRes = await fetch(`${BASE_URL}/students/${testStudent.studentId}/fee-summary`, {
    headers: { 'Authorization': `Bearer ${accToken}` }
  });
  const postPaySum = await postPaySumRes.json();
  const updatedTuition = postPaySum.data?.currentYearSummary?.categories?.find(c => c.category === 'Tuition Fee');
  assert(
    updatedTuition && updatedTuition.paidAmount === (initialTuition.paidAmount || 0) + 5000,
    `Tuition Fee paid amount increased by ₹5,000 (Now: ₹${updatedTuition?.paidAmount})`
  );
  assert(
    updatedTuition && updatedTuition.remainingAmount === initialTuition.remainingAmount - 5000,
    `Tuition Fee remaining balance accurately decreased by ₹5,000 (Now: ₹${updatedTuition?.remainingAmount})`
  );

  // Check Student Ledger from /api/students/:id/ledger
  const ledgerRes = await fetch(`${BASE_URL}/students/${testStudent.studentId}/ledger`, {
    headers: { 'Authorization': `Bearer ${accToken}` }
  });
  const ledgerData = await ledgerRes.json();
  const ledgerEntries = ledgerData.data?.entries || [];
  const paymentLedgerEntry = ledgerEntries.find(e => e.receiptNo === paymentReceipt);
  assert(paymentLedgerEntry, 'Payment appears in student fee ledger');
  assert(paymentLedgerEntry?.category === 'Tuition Fee', `Ledger entry identifies Fee Category: "${paymentLedgerEntry?.category}"`);
  assert(paymentLedgerEntry?.academicYear === '2026-27', `Ledger entry identifies Academic Year: "${paymentLedgerEntry?.academicYear}"`);
  assert(paymentLedgerEntry?.credit === 5000, `Ledger credit matches payment amount: ₹${paymentLedgerEntry?.credit}`);
  assert(typeof paymentLedgerEntry?.balance === 'number', `Ledger maintains running balance: ₹${paymentLedgerEntry?.balance}`);

  console.log('\n=====================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('=====================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');
const { performance } = require('perf_hooks');
const connectDB = require('../config/db');
const Student = require('../models/Student');
const FeeDemand = require('../models/FeeDemand');
const Payment = require('../models/Payment');
const { calculateFeeSummary, calculateBatchFeeSummaries } = require('../utils/feeCalculator');
const reportController = require('../controllers/reportController');

async function runBenchmark() {
  console.log('--- Starting Production Performance Benchmark ---');
  const t0 = performance.now();
  await connectDB();
  const connTime = performance.now() - t0;
  console.log(`[1] MongoDB Connection Time: ${connTime.toFixed(2)}ms`);

  const students = await Student.find({ status: 'Active' }).limit(20).lean();
  console.log(`[2] Found ${students.length} active students for testing`);

  if (students.length > 0) {
    // Benchmark Batch Fee Calculation vs Serial Calculation
    const batchStart = performance.now();
    const batchResults = await calculateBatchFeeSummaries(students);
    const batchDuration = performance.now() - batchStart;
    console.log(`[3] Batch Fee Calculation (${students.length} students): ${batchDuration.toFixed(2)}ms (Avg: ${(batchDuration / students.length).toFixed(2)}ms/student)`);

    // Benchmark Single Student Fee Calculation
    const singleStart = performance.now();
    await calculateFeeSummary(students[0].studentId);
    const singleDuration = performance.now() - singleStart;
    console.log(`[4] Single Student Fee Calculation (${students[0].studentId}): ${singleDuration.toFixed(2)}ms`);
  }

  // Benchmark Dashboard Stats Execution
  const fakeReq = {};
  let dashboardData = null;
  const fakeRes = {
    locals: { timings: {}, trackTiming: (k, v) => {} },
    json: (payload) => { dashboardData = payload; },
    status: (code) => fakeRes,
    setHeader: () => {},
    end: () => {}
  };

  const dashStart = performance.now();
  await reportController.getDashboardStats(fakeReq, fakeRes);
  const dashDuration = performance.now() - dashStart;
  console.log(`[5] Full Dashboard Stats Controller Execution: ${dashDuration.toFixed(2)}ms (Success: ${dashboardData?.success})`);

  console.log('--- Benchmark Complete ---');
  await mongoose.connection.close();
}

runBenchmark().catch((err) => {
  console.error('Benchmark Error:', err);
  process.exit(1);
});

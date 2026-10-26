const Payment = require('../models/Payment');
const Student = require('../models/Student');
const FeeDemand = require('../models/FeeDemand');
const Course = require('../models/Course');
const FeeCategory = require('../models/FeeCategory');
const { calculateFeeSummary, calculateBatchFeeSummaries, computeStudentSummary } = require('../utils/feeCalculator');

const escapeRegex = (s) => (s ? s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : '');

// @desc    Get dashboard stats
// @route   GET /api/reports/dashboard
exports.getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1, 0, 0, 0, 0);
    const monthNamesFull = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonthName = monthNamesFull[today.getMonth()];
    const currentCalendarYear = today.getFullYear();
    const currentMonthLabel = `${currentMonthName} ${currentCalendarYear}`;

    // For Yearly Fee Inflow
    const inflowYear = parseInt(req.query.inflowYear) || currentCalendarYear;
    const startOfInflowYear = new Date(inflowYear, 0, 1, 0, 0, 0, 0);
    const startOfNextInflowYear = new Date(inflowYear + 1, 0, 1, 0, 0, 0, 0);

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    // Concurrently execute all independent dashboard metric queries in parallel
    const [
      totalStudents,
      feeAgg,
      collectionAgg,
      todayAgg,
      currentMonthAgg,
      yearlyInflowAgg,
      distinctPaymentYears,
      recentPayments,
      monthlyCollectionLegacy,
      courseCollection,
      modeDistribution,
      candidateStudents,
      upcomingDemands
    ] = await Promise.all([
      Student.countDocuments({ status: 'Active' }),

      FeeDemand.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, totalFee: { $sum: '$totalDemand' } } }
      ]),

      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, totalCollected: { $sum: '$amountPaid' } } }
      ]),

      Payment.aggregate([
        { $match: { paymentDate: { $gte: today, $lt: tomorrow }, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amountPaid' }, count: { $sum: 1 } } }
      ]),

      Payment.aggregate([
        {
          $match: {
            paymentDate: { $gte: startOfMonth, $lt: startOfNextMonth },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amountPaid' },
            count: { $sum: 1 }
          }
        }
      ]),

      Payment.aggregate([
        {
          $match: {
            paymentDate: { $gte: startOfInflowYear, $lt: startOfNextInflowYear },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: { $month: '$paymentDate' },
            total: { $sum: '$amountPaid' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]),

      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: { $year: '$paymentDate' } } },
        { $sort: { _id: -1 } }
      ]),

      Payment.find({ status: 'completed' })
        .populate('student', 'name admissionNo course')
        .sort({ paymentDate: -1 })
        .limit(10)
        .lean(),

      Payment.aggregate([
        {
          $match: {
            paymentDate: { $gte: twelveMonthsAgo },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$paymentDate' },
              month: { $month: '$paymentDate' }
            },
            total: { $sum: '$amountPaid' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),

      Payment.aggregate([
        { $match: { status: 'completed' } },
        {
          $lookup: {
            from: 'students',
            localField: 'student',
            foreignField: '_id',
            as: 'studentData'
          }
        },
        { $unwind: '$studentData' },
        {
          $group: {
            _id: '$studentData.course',
            total: { $sum: '$amountPaid' },
            count: { $sum: 1 }
          }
        },
        { $sort: { total: -1 } }
      ]),

      Payment.aggregate([
        { $match: { status: 'completed' } },
        {
          $group: {
            _id: '$paymentMode',
            total: { $sum: '$amountPaid' },
            count: { $sum: 1 }
          }
        },
        { $sort: { total: -1 } }
      ]),

      Student.find({ status: 'Active' }).limit(50).lean(),

      FeeDemand.find({
        status: 'active',
        'categories.activationDate': { $gt: today }
      }).lean()
    ]);

    const totalFee = feeAgg[0]?.totalFee || 0;
    const totalCollected = collectionAgg[0]?.totalCollected || 0;
    const totalPending = Math.max(0, totalFee - totalCollected);

    // Format Yearly Fee Inflow
    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const inflowMap = new Map();
    for (const item of yearlyInflowAgg) {
      inflowMap.set(item._id, item);
    }
    const yearlyInflow = monthNamesShort.map((mName, idx) => {
      const monthNum = idx + 1;
      const data = inflowMap.get(monthNum);
      return {
        month: mName,
        monthName: monthNamesFull[idx],
        fullMonth: `${monthNamesFull[idx]} ${inflowYear}`,
        monthIndex: monthNum,
        year: inflowYear,
        amount: data ? data.total : 0,
        count: data ? data.count : 0
      };
    });

    const pyYears = distinctPaymentYears.map(p => p._id).filter(Boolean);
    const availableInflowYears = Array.from(new Set([currentCalendarYear, currentCalendarYear - 1, currentCalendarYear - 2, ...pyYears])).sort((a, b) => b - a);

    // Batch calculate high pending students in 2 queries total (instead of 150-300 queries)
    const summaryMap = await calculateBatchFeeSummaries(candidateStudents);
    const highPending = [];

    for (const student of candidateStudents) {
      const summary = summaryMap.get(student._id.toString());
      if (summary && summary.overall.totalPending > 0) {
        highPending.push({
          studentId: student.studentId,
          name: student.name,
          course: student.course,
          level: student.level,
          batch: student.batch,
          currentYear: student.currentYear,
          totalPending: summary.overall.totalPending,
          feeStatus: summary.overall.status
        });
      }
    }
    highPending.sort((a, b) => b.totalPending - a.totalPending);

    // Process upcoming demands
    const upcomingMap = {};
    for (const demand of upcomingDemands) {
      for (const cat of demand.categories || []) {
        if (cat.activationDate && new Date(cat.activationDate) > today) {
          const key = `${cat.category}|${cat.semester || ''}|${new Date(cat.activationDate).toISOString().split('T')[0]}`;
          if (!upcomingMap[key]) {
            upcomingMap[key] = {
              category: cat.category,
              semester: cat.semester,
              amount: cat.amount,
              activationDate: cat.activationDate,
              dueDate: cat.dueDate,
              studentCount: 0
            };
          }
          upcomingMap[key].studentCount++;
        }
      }
    }
    const upcomingFeeActivations = Object.values(upcomingMap).sort((a, b) => new Date(a.activationDate) - new Date(b.activationDate));

    res.json({
      success: true,
      data: {
        totalStudents,
        totalFee,
        totalCollected,
        totalPending,
        // Monthly Collection
        monthlyCollection: {
          total: currentMonthAgg[0]?.total || 0,
          count: currentMonthAgg[0]?.count || 0,
          monthName: currentMonthName,
          year: currentCalendarYear,
          label: currentMonthLabel
        },
        todayCollection: todayAgg[0]?.total || 0,
        todayCount: todayAgg[0]?.count || 0,
        recentPayments,
        monthlyCollectionLegacy,
        yearlyInflow,
        yearlyInflowYear: inflowYear,
        availableInflowYears,
        courseCollection,
        modeDistribution,
        highPendingStudents: highPending.slice(0, 10),
        upcomingFeeActivations
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get pending fees report
// @route   GET /api/reports/pending
exports.getPendingReport = async (req, res) => {
  try {
    const { course, level, year, academicYear } = req.query;

    const filter = { status: 'Active' };
    if (course) filter.course = course;
    if (level) filter.level = level;
    if (year) filter.currentYear = year;
    if (academicYear) filter.currentAcademicYear = academicYear;

    const students = await Student.find(filter).lean();
    if (students.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Batch calculate fee summaries for all students in 2 queries total
    const summaryMap = await calculateBatchFeeSummaries(students);
    const pendingList = [];

    for (const student of students) {
      const summary = summaryMap.get(student._id.toString());
      if (summary && summary.overall.totalPending > 0) {
        const currentYearSummary = summary.currentYearSummary;
        pendingList.push({
          studentId: student.studentId,
          admissionNo: student.admissionNo,
          name: student.name,
          course: student.course,
          level: student.level,
          currentYear: student.currentYear,
          totalPayable: summary.overall.totalFee,
          totalPaid: summary.overall.totalPaid,
          totalPending: summary.overall.totalPending,
          previousYearDue: currentYearSummary?.previousYearDue || 0,
          feeStatus: summary.overall.status
        });
      }
    }

    pendingList.sort((a, b) => b.totalPending - a.totalPending);

    res.json({ success: true, data: pendingList });
  } catch (error) {
    console.error('Pending report error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get collection report
// @route   GET /api/reports/collection
exports.getCollectionReport = async (req, res) => {
  try {
    const { academicYear, course, level, year, paymentMode, dateFrom, dateTo } = req.query;

    const matchStage = { status: 'completed' };
    if (academicYear) matchStage.academicYear = academicYear;
    if (paymentMode) matchStage.paymentMode = paymentMode;
    if (dateFrom || dateTo) {
      matchStage.paymentDate = {};
      if (dateFrom) matchStage.paymentDate.$gte = new Date(dateFrom);
      if (dateTo) matchStage.paymentDate.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'students',
          localField: 'student',
          foreignField: '_id',
          as: 'studentData'
        }
      },
      { $unwind: '$studentData' }
    ];

    if (course) pipeline.push({ $match: { 'studentData.course': course } });
    if (level) pipeline.push({ $match: { 'studentData.level': level } });

    // Summary pipeline
    const summaryPipeline = [...pipeline, {
      $group: {
        _id: null,
        totalCollection: { $sum: '$amountPaid' },
        totalTransactions: { $sum: 1 }
      }
    }];

    // Course-wise pipeline
    const courseWisePipeline = [...pipeline, {
      $group: {
        _id: '$studentData.course',
        total: { $sum: '$amountPaid' },
        count: { $sum: 1 }
      }
    }, { $sort: { total: -1 } }];

    // Year-wise pipeline
    const yearWisePipeline = [...pipeline, {
      $group: {
        _id: '$year',
        total: { $sum: '$amountPaid' },
        count: { $sum: 1 }
      }
    }, { $sort: { _id: 1 } }];

    // Daily pipeline (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyPipeline = [
      { $match: { ...matchStage, paymentDate: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paymentDate' } },
          total: { $sum: '$amountPaid' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];

    // Run all collection aggregation pipelines concurrently
    const [summary, courseWise, yearWise, daily] = await Promise.all([
      Payment.aggregate(summaryPipeline),
      Payment.aggregate(courseWisePipeline),
      Payment.aggregate(yearWisePipeline),
      Payment.aggregate(dailyPipeline)
    ]);

    res.json({
      success: true,
      data: {
        totalCollection: summary[0]?.totalCollection || 0,
        totalTransactions: summary[0]?.totalTransactions || 0,
        courseWise,
        yearWise,
        daily
      }
    });
  } catch (error) {
    console.error('Collection report error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get aging report
// @route   GET /api/reports/aging
exports.getAgingReport = async (req, res) => {
  try {
    const { course, level } = req.query;
    const filter = { status: 'Active' };
    if (course) filter.course = course;
    if (level) filter.level = level;

    const students = await Student.find(filter).lean();
    if (students.length === 0) {
      return res.json({
        success: true,
        data: {
          '0-30': { students: [], total: 0 },
          '31-60': { students: [], total: 0 },
          '61-90': { students: [], total: 0 },
          '90+': { students: [], total: 0 }
        }
      });
    }

    const studentObjectIds = students.map(s => s._id);
    const now = new Date();

    // Fetch all demands and payments for all students concurrently (2 queries total)
    const [allDemands, allPayments] = await Promise.all([
      FeeDemand.find({
        student: { $in: studentObjectIds },
        status: 'active'
      }).sort({ academicYear: 1 }).lean(),
      Payment.find({
        student: { $in: studentObjectIds },
        status: 'completed'
      }).sort({ paymentDate: 1 }).lean()
    ]);

    // Group in memory by student ObjectId
    const demandsByStudent = new Map();
    const paymentsByStudent = new Map();

    for (const d of allDemands) {
      const k = d.student.toString();
      if (!demandsByStudent.has(k)) demandsByStudent.set(k, []);
      demandsByStudent.get(k).push(d);
    }

    for (const p of allPayments) {
      const k = p.student.toString();
      if (!paymentsByStudent.has(k)) paymentsByStudent.set(k, []);
      paymentsByStudent.get(k).push(p);
    }

    const aging = {
      '0-30': { students: [], total: 0 },
      '31-60': { students: [], total: 0 },
      '61-90': { students: [], total: 0 },
      '90+': { students: [], total: 0 }
    };

    for (const student of students) {
      const sId = student._id.toString();
      const sDemands = demandsByStudent.get(sId) || [];
      const sPayments = paymentsByStudent.get(sId) || [];

      // Compute in memory with zero database roundtrips
      const summary = computeStudentSummary(student, sDemands, sPayments, null, now);
      if (summary.overall.totalPending <= 0) continue;

      const unpaidDemands = summary.yearSummaries.filter(s => s.pending > 0);
      if (unpaidDemands.length === 0) continue;

      // Oldest unpaid demand is already in the memory array
      const oldestDemand = sDemands.find(d => d.academicYear === unpaidDemands[0].academicYear);
      const daysOutstanding = oldestDemand
        ? Math.floor((now - new Date(oldestDemand.createdAt)) / (1000 * 60 * 60 * 24))
        : 0;

      const entry = {
        studentId: student.studentId,
        admissionNo: student.admissionNo,
        name: student.name,
        course: student.course,
        level: student.level,
        currentYear: student.currentYear,
        totalPending: summary.overall.totalPending,
        daysOutstanding
      };

      if (daysOutstanding <= 30) {
        aging['0-30'].students.push(entry);
        aging['0-30'].total += summary.overall.totalPending;
      } else if (daysOutstanding <= 60) {
        aging['31-60'].students.push(entry);
        aging['31-60'].total += summary.overall.totalPending;
      } else if (daysOutstanding <= 90) {
        aging['61-90'].students.push(entry);
        aging['61-90'].total += summary.overall.totalPending;
      } else {
        aging['90+'].students.push(entry);
        aging['90+'].total += summary.overall.totalPending;
      }
    }

    res.json({ success: true, data: aging });
  } catch (error) {
    console.error('Aging report error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get Yearly Fee Inflow aggregated by month for selected calendar year
// @route   GET /api/reports/yearly-inflow
exports.getYearlyInflow = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const selectedYear = parseInt(req.query.year) || currentYear;
    const startOfYear = new Date(selectedYear, 0, 1, 0, 0, 0, 0);
    const startOfNextYear = new Date(selectedYear + 1, 0, 1, 0, 0, 0, 0);

    const [monthlyAgg, distinctYearsAgg] = await Promise.all([
      Payment.aggregate([
        {
          $match: {
            paymentDate: { $gte: startOfYear, $lt: startOfNextYear },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: { $month: '$paymentDate' },
            total: { $sum: '$amountPaid' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]),
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: { $year: '$paymentDate' } } },
        { $sort: { _id: -1 } }
      ])
    ]);

    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthNamesFull = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const inflowMap = new Map();
    for (const item of monthlyAgg) {
      inflowMap.set(item._id, item);
    }

    const monthlyData = monthNamesShort.map((mName, idx) => {
      const monthNum = idx + 1;
      const data = inflowMap.get(monthNum);
      return {
        month: mName,
        monthName: monthNamesFull[idx],
        fullMonth: `${monthNamesFull[idx]} ${selectedYear}`,
        monthIndex: monthNum,
        year: selectedYear,
        amount: data ? data.total : 0,
        count: data ? data.count : 0
      };
    });

    const paymentYears = distinctYearsAgg.map(p => p._id).filter(Boolean);
    const availableYears = Array.from(new Set([currentYear, currentYear - 1, currentYear - 2, ...paymentYears])).sort((a, b) => b - a);

    res.json({
      success: true,
      data: {
        year: selectedYear,
        availableYears,
        monthlyData,
        totalCollected: monthlyData.reduce((s, m) => s + m.amount, 0),
        totalTransactions: monthlyData.reduce((s, m) => s + m.count, 0)
      }
    });
  } catch (error) {
    console.error('Yearly inflow error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get 3 Side-by-Side Fee Analytics (Fee to Be Collected, Fee Paid, Fee Pending by Category)
// @route   GET /api/reports/fee-analytics
exports.getFeeAnalytics = async (req, res) => {
  try {
    const { academicYear, calendarYear, course, studyYear, semester } = req.query;

    // 1. Fee to Be Collected (Assessed amounts across categories from active demands)
    const demandFilter = { status: 'active' };
    if (academicYear) demandFilter.academicYear = academicYear;
    if (course) demandFilter.course = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
    if (studyYear) demandFilter.year = new RegExp(`^${escapeRegex(studyYear.trim())}$`, 'i');
    if (calendarYear) {
      const calYear = parseInt(calendarYear);
      demandFilter.createdAt = {
        $gte: new Date(calYear, 0, 1),
        $lt: new Date(calYear + 1, 0, 1)
      };
    }

    const matchedDemands = await FeeDemand.find(demandFilter).lean();

    const assessedByCategory = new Map();
    let totalAssessedAmount = 0;

    for (const demand of matchedDemands) {
      for (const cat of demand.categories || []) {
        if (semester && cat.semester && cat.semester.toLowerCase() !== semester.toLowerCase()) {
          continue;
        }
        const catName = cat.category.trim();
        const amt = cat.amount || 0;
        assessedByCategory.set(catName, (assessedByCategory.get(catName) || 0) + amt);
        totalAssessedAmount += amt;
      }
    }

    // 2. Fee Paid (Collected payments across categories based on actual completed allocations)
    const paymentFilter = { status: 'completed' };
    if (academicYear) paymentFilter.academicYear = academicYear;
    if (studyYear) paymentFilter.year = new RegExp(`^${escapeRegex(studyYear.trim())}$`, 'i');
    if (calendarYear) {
      const calYear = parseInt(calendarYear);
      paymentFilter.paymentDate = {
        $gte: new Date(calYear, 0, 1),
        $lt: new Date(calYear + 1, 0, 1)
      };
    }

    let matchedPayments = await Payment.find(paymentFilter)
      .populate('student', 'course currentYear status')
      .lean();

    if (course) {
      const courseRegex = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
      matchedPayments = matchedPayments.filter(p => p.student && courseRegex.test(p.student.course));
    }

    const paidByCategory = new Map();
    let totalPaidAmount = 0;

    for (const p of matchedPayments) {
      if (p.allocations && p.allocations.length > 0) {
        for (const alloc of p.allocations) {
          if (semester && alloc.semester && alloc.semester.toLowerCase() !== semester.toLowerCase()) {
            continue;
          }
          const catName = (alloc.category || 'Tuition Fee').trim();
          const amt = alloc.amount || 0;
          paidByCategory.set(catName, (paidByCategory.get(catName) || 0) + amt);
          totalPaidAmount += amt;
        }
      } else {
        // Historical payments without explicit allocation array
        const catName = (p.feeCategory || 'Tuition Fee').trim();
        paidByCategory.set(catName, (paidByCategory.get(catName) || 0) + (p.amountPaid || 0));
        totalPaidAmount += (p.amountPaid || 0);
      }
    }

    // 3. Fee Pending (Outstanding balances across categories = max(0, assessed - paid))
    const allDbCategories = await FeeCategory.find({ status: 'active' }).distinct('name');
    const allCategoryNames = Array.from(new Set([
      ...allDbCategories,
      ...Array.from(assessedByCategory.keys()),
      ...Array.from(paidByCategory.keys())
    ])).filter(Boolean);

    const pendingByCategory = new Map();
    let totalPendingAmount = 0;

    for (const catName of allCategoryNames) {
      const assessed = assessedByCategory.get(catName) || 0;
      const paid = paidByCategory.get(catName) || 0;
      const pending = Math.max(0, assessed - paid);
      if (pending > 0) {
        pendingByCategory.set(catName, pending);
        totalPendingAmount += pending;
      }
    }

    // Format Pie 1: Fee to Be Collected
    const feeToBeCollected = Array.from(assessedByCategory.entries())
      .filter(([_, amount]) => amount > 0)
      .map(([category, amount]) => ({
        name: category,
        category,
        amount,
        percentage: totalAssessedAmount > 0 ? parseFloat(((amount / totalAssessedAmount) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Format Pie 2: Fee Paid
    const feePaid = Array.from(paidByCategory.entries())
      .filter(([_, amount]) => amount > 0)
      .map(([category, amount]) => ({
        name: category,
        category,
        amount,
        percentage: totalPaidAmount > 0 ? parseFloat(((amount / totalPaidAmount) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Format Pie 3: Fee Pending
    const feePending = Array.from(pendingByCategory.entries())
      .map(([category, amount]) => ({
        name: category,
        category,
        amount,
        percentage: totalPendingAmount > 0 ? parseFloat(((amount / totalPendingAmount) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Filter Options dynamically extracted from MongoDB
    const [academicYears, courses, distinctPaymentYears] = await Promise.all([
      FeeDemand.distinct('academicYear'),
      Course.find({ status: 'active' }).distinct('courseName'),
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: { $year: '$paymentDate' } } },
        { $sort: { _id: -1 } }
      ])
    ]);

    const calYears = distinctPaymentYears.map(p => p._id).filter(Boolean);
    const thisYear = new Date().getFullYear();
    const availableCalendarYears = Array.from(new Set([thisYear, thisYear - 1, ...calYears])).sort((a, b) => b - a);

    res.json({
      success: true,
      data: {
        feeToBeCollected,
        feePaid,
        feePending,
        totals: {
          totalDemand: totalAssessedAmount,
          totalPaid: totalPaidAmount,
          totalPending: totalPendingAmount
        },
        filterOptions: {
          academicYears: academicYears.filter(Boolean).sort().reverse(),
          calendarYears: availableCalendarYears,
          courses: courses.filter(Boolean).sort(),
          studyYears: ['1st Year', '2nd Year', '3rd Year'],
          semesters: ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6']
        }
      }
    });
  } catch (error) {
    console.error('Fee analytics error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

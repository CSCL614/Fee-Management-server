const Payment = require('../models/Payment');
const Student = require('../models/Student');
const FeeDemand = require('../models/FeeDemand');
const { calculateFeeSummary, calculateBatchFeeSummaries, computeStudentSummary } = require('../utils/feeCalculator');

// @desc    Get dashboard stats
// @route   GET /api/reports/dashboard
exports.getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

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
      recentPayments,
      monthlyCollection,
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
        todayCollection: todayAgg[0]?.total || 0,
        todayCount: todayAgg[0]?.count || 0,
        recentPayments,
        monthlyCollection,
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

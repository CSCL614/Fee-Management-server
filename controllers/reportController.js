const Payment = require('../models/Payment');
const Student = require('../models/Student');
const FeeDemand = require('../models/FeeDemand');
const { calculateFeeSummary } = require('../utils/feeCalculator');

// @desc    Get dashboard stats
// @route   GET /api/reports/dashboard
exports.getDashboardStats = async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments({ status: 'Active' });

    // Total fee demands
    const feeAgg = await FeeDemand.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, totalFee: { $sum: '$totalDemand' } } }
    ]);
    const totalFee = feeAgg[0]?.totalFee || 0;

    // Total collected
    const collectionAgg = await Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, totalCollected: { $sum: '$amountPaid' } } }
    ]);
    const totalCollected = collectionAgg[0]?.totalCollected || 0;
    const totalPending = Math.max(0, totalFee - totalCollected);

    // Today's collection
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAgg = await Payment.aggregate([
      { $match: { paymentDate: { $gte: today, $lt: tomorrow }, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amountPaid' }, count: { $sum: 1 } } }
    ]);

    // Recent payments
    const recentPayments = await Payment.find({ status: 'completed' })
      .populate('student', 'name admissionNo course')
      .sort({ paymentDate: -1 })
      .limit(10);

    // Monthly collection (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyCollection = await Payment.aggregate([
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
    ]);

    // Course-wise collection
    const courseCollection = await Payment.aggregate([
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
    ]);

    // Payment mode distribution
    const modeDistribution = await Payment.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$paymentMode',
          total: { $sum: '$amountPaid' },
          count: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ]);

    // Students with high pending
    const students = await Student.find({ status: 'Active' }).limit(100);
    const highPending = [];
    for (const student of students) {
      try {
        const summary = await calculateFeeSummary(student.studentId);
        if (summary.overall.totalPending > 0) {
          highPending.push({
            studentId: student.studentId,
            name: student.name,
            course: student.course,
            level: student.level,
            currentYear: student.currentYear,
            totalPending: summary.overall.totalPending,
            feeStatus: summary.overall.status
          });
        }
      } catch { /* skip */ }
    }
    highPending.sort((a, b) => b.totalPending - a.totalPending);

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
        highPendingStudents: highPending.slice(0, 10)
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

    const students = await Student.find(filter);
    const pendingList = [];

    for (const student of students) {
      try {
        const summary = await calculateFeeSummary(student.studentId);
        if (summary.overall.totalPending > 0) {
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
      } catch { /* skip */ }
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

    // Summary
    const summaryPipeline = [...pipeline, {
      $group: {
        _id: null,
        totalCollection: { $sum: '$amountPaid' },
        totalTransactions: { $sum: 1 }
      }
    }];

    const summary = await Payment.aggregate(summaryPipeline);

    // Course-wise
    const courseWisePipeline = [...pipeline, {
      $group: {
        _id: '$studentData.course',
        total: { $sum: '$amountPaid' },
        count: { $sum: 1 }
      }
    }, { $sort: { total: -1 } }];

    const courseWise = await Payment.aggregate(courseWisePipeline);

    // Year-wise
    const yearWisePipeline = [...pipeline, {
      $group: {
        _id: '$year',
        total: { $sum: '$amountPaid' },
        count: { $sum: 1 }
      }
    }, { $sort: { _id: 1 } }];

    const yearWise = await Payment.aggregate(yearWisePipeline);

    // Daily (last 30 days)
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

    const daily = await Payment.aggregate(dailyPipeline);

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

    const students = await Student.find(filter);
    const now = new Date();

    const aging = {
      '0-30': { students: [], total: 0 },
      '31-60': { students: [], total: 0 },
      '61-90': { students: [], total: 0 },
      '90+': { students: [], total: 0 }
    };

    for (const student of students) {
      try {
        const summary = await calculateFeeSummary(student.studentId);
        if (summary.overall.totalPending <= 0) continue;

        // Calculate days outstanding from the earliest unpaid demand
        const unpaidDemands = summary.yearSummaries.filter(s => s.pending > 0);
        if (unpaidDemands.length === 0) continue;

        // Find the oldest demand with pending amount
        const oldestDemand = await FeeDemand.findOne({
          student: student._id,
          academicYear: unpaidDemands[0].academicYear,
          status: 'active'
        });

        const daysOutstanding = oldestDemand
          ? Math.floor((now - oldestDemand.createdAt) / (1000 * 60 * 60 * 24))
          : 0;

        const entry = {
          studentId: student.studentId,
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
      } catch { /* skip */ }
    }

    res.json({ success: true, data: aging });
  } catch (error) {
    console.error('Aging report error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

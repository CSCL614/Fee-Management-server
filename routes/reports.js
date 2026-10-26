const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getDashboardStats,
  getPendingReport,
  getCollectionReport,
  getAgingReport,
  getYearlyInflow,
  getFeeAnalytics
} = require('../controllers/reportController');

router.get('/dashboard', protect, getDashboardStats);
router.get('/yearly-inflow', protect, getYearlyInflow);
router.get('/fee-analytics', protect, getFeeAnalytics);
router.get('/pending', protect, getPendingReport);
router.get('/collection', protect, getCollectionReport);
router.get('/aging', protect, getAgingReport);

module.exports = router;

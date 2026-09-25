const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { getAuditLogs, getAcademicYears, createAcademicYear, getSettings, updateSettings } = require('../controllers/auditController');

router.get('/', protect, authorize('admin'), getAuditLogs);
router.get('/academic-years', protect, getAcademicYears);
router.post('/academic-years', protect, authorize('admin'), createAcademicYear);
router.get('/settings', protect, getSettings);
router.put('/settings', protect, authorize('admin'), updateSettings);

module.exports = router;

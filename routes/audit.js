const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getAuditLogs,
  getAcademicYears,
  createAcademicYear,
  updateAcademicYear,
  toggleAcademicYearStatus,
  deleteAcademicYear,
  getSettings,
  updateSettings
} = require('../controllers/auditController');

router.get('/', protect, authorize('admin'), getAuditLogs);

// Requirement 5: Academic Year Configuration (Admin only for mutations)
router.get('/academic-years', protect, getAcademicYears);
router.post('/academic-years', protect, authorize('admin'), createAcademicYear);
router.put('/academic-years/:id', protect, authorize('admin'), updateAcademicYear);
router.patch('/academic-years/:id/status', protect, authorize('admin'), toggleAcademicYearStatus);
router.delete('/academic-years/:id', protect, authorize('admin'), deleteAcademicYear);

// Settings
router.get('/settings', protect, getSettings);
router.put('/settings', protect, authorize('admin'), updateSettings);

module.exports = router;

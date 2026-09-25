const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getStudents, searchStudents, getStudent, createStudent,
  updateStudent, promoteStudent, getFeeSummary, getFeeLedger, getCourses
} = require('../controllers/studentController');

router.get('/courses', protect, getCourses);
router.get('/search', protect, searchStudents);
router.get('/', protect, getStudents);
router.get('/:id', protect, getStudent);
router.get('/:id/fee-summary', protect, getFeeSummary);
router.get('/:id/ledger', protect, getFeeLedger);
router.post('/', protect, authorize('admin'), createStudent);
router.put('/:id', protect, authorize('admin'), updateStudent);
router.post('/:id/promote', protect, authorize('admin'), promoteStudent);

module.exports = router;

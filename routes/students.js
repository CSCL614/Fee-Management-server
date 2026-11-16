const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const uploadPhoto = require('../middleware/photoUpload');
const {
  getStudents, searchStudents, getStudent, createStudent,
  updateStudent, updateStudentStatus, deleteStudent,
  promoteStudent, getFeeSummary, getFeeLedger, getCourses,
  uploadTempPhoto, uploadStudentPhoto, deleteStudentPhoto, getStudentPhoto,
  previewBulkDelete, bulkDeleteStudents,
  getStudentConcession, updateStudentConcession,
  getGraduatedStudents, getGraduationSuggestions, graduateStudent,
  restoreStudent, updateAcademicResults, bulkGraduateStudents
} = require('../controllers/studentController');

// Public/direct image serving endpoint
router.get('/photo/:filename', getStudentPhoto);

// Read student list and filters (Admin and Accountant)
router.get('/courses', protect, getCourses);
router.get('/search', protect, searchStudents);

// Graduated Students Management
router.get('/graduated', protect, getGraduatedStudents);
router.get('/graduation/suggestions', protect, authorize('admin'), getGraduationSuggestions);

router.get('/', protect, getStudents);

// Requirement 3: Multi-Student Selection and Bulk Deletion (Admin only)
router.post('/bulk-delete/preview', protect, authorize('admin'), previewBulkDelete);
router.post('/bulk-delete', protect, authorize('admin'), bulkDeleteStudents);

// Requirement 2: Temp Photo Upload (Admin and Accountant)
router.post('/upload-photo', protect, authorize('admin', 'accountant'), uploadPhoto.single('photo'), uploadTempPhoto);

// Graduated Student Actions (Admin only)
router.post('/bulk-graduate', protect, authorize('admin'), bulkGraduateStudents);

// Student detail routes
router.get('/:id', protect, getStudent);
router.get('/:id/fee-summary', protect, getFeeSummary);
router.get('/:id/ledger', protect, getFeeLedger);

// Requirement 6: Tuition Fee Concession (Admin and Accountant)
router.get('/:id/concession', protect, getStudentConcession);
router.post('/:id/concession', protect, authorize('admin', 'accountant'), updateStudentConcession);

// Graduated Student Actions (Admin only)
router.post('/:id/graduate', protect, authorize('admin'), graduateStudent);
router.post('/:id/restore', protect, authorize('admin'), restoreStudent);
router.put('/:id/academic-results', protect, authorize('admin'), updateAcademicResults);

// Requirement 2: Existing Student Photo Upload & Removal (Admin and Accountant)
router.post('/:id/photo', protect, authorize('admin', 'accountant'), uploadPhoto.single('photo'), uploadStudentPhoto);
router.delete('/:id/photo', protect, authorize('admin', 'accountant'), deleteStudentPhoto);

// Requirement 4: Allow Accountants to Add and Edit Student Profiles
router.post('/', protect, authorize('admin', 'accountant'), createStudent);
router.put('/:id', protect, authorize('admin', 'accountant'), updateStudent);

// Admin-only operations
router.patch('/:id/status', protect, authorize('admin'), updateStudentStatus);
router.delete('/:id', protect, authorize('admin'), deleteStudent);
router.post('/:id/promote', protect, authorize('admin'), promoteStudent);

module.exports = router;

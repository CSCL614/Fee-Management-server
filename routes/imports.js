const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getSampleTemplate,
  previewImport,
  confirmImport,
  getImportComments,
  exportImportComments,
  verifyImportComment,
  createPaymentFromComment
} = require('../controllers/importController');

// All import routes are strictly restricted to Admin users
router.get('/template', protect, authorize('admin'), getSampleTemplate);
router.post('/preview', protect, authorize('admin'), previewImport);
router.post('/confirm', protect, authorize('admin'), confirmImport);

// Cell Comments extraction, verification and payment creation routes
router.get('/comments/export', protect, authorize('admin'), exportImportComments);
router.get('/comments', protect, authorize('admin'), getImportComments);
router.patch('/comments/:id/verify', protect, authorize('admin'), verifyImportComment);
router.post('/comments/:id/create-payment', protect, authorize('admin'), createPaymentFromComment);

module.exports = router;

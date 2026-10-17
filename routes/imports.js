const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getSampleTemplate,
  previewImport,
  confirmImport
} = require('../controllers/importController');

// All import routes are strictly restricted to Admin users
router.get('/template', protect, authorize('admin'), getSampleTemplate);
router.post('/preview', protect, authorize('admin'), previewImport);
router.post('/confirm', protect, authorize('admin'), confirmImport);

module.exports = router;

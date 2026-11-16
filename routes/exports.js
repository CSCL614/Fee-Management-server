const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  exportMasterWorkbook,
  getMasterWorkbookCount,
  exportPendingFeesExcel,
  previewPendingFeesExport,
  exportFullExcel,
  exportFilteredExcel
} = require('../controllers/exportController');

// Pending Fee Detailed Excel Export and Live Preview (Admin & Accountant)
router.get('/pending-fees/preview', protect, authorize('admin', 'accountant'), previewPendingFeesExport);
router.get('/pending-fees', protect, authorize('admin', 'accountant'), exportPendingFeesExcel);

// Requirement 7: Export Master Workbook with filters and preview count
router.get('/master-workbook/count', protect, authorize('admin'), getMasterWorkbookCount);
router.get('/master-workbook', protect, authorize('admin'), exportMasterWorkbook);

// Legacy routes redirected to Master Workbook
router.get('/excel', protect, authorize('admin'), exportMasterWorkbook);
router.get('/filtered-excel', protect, authorize('admin'), exportMasterWorkbook);

module.exports = router;

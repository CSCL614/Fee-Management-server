const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { exportFullExcel, exportFilteredExcel } = require('../controllers/exportController');

router.get('/excel', protect, authorize('admin'), exportFullExcel);
router.get('/filtered-excel', protect, exportFilteredExcel);

module.exports = router;

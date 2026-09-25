const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  recordPayment, getPayments, getPayment,
  editPayment, cancelPayment, getTodayCollection
} = require('../controllers/paymentController');

router.get('/today', protect, getTodayCollection);
router.get('/', protect, getPayments);
router.get('/:id', protect, getPayment);
router.post('/', protect, recordPayment);
router.put('/:id', protect, authorize('admin'), editPayment);
router.patch('/:id/cancel', protect, authorize('admin'), cancelPayment);

module.exports = router;

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getCategories, createCategory, updateCategory,
  getStructures, createStructure, updateStructure, deleteStructure,
  getDemands, createDemand, generateDemoFeeStructures
} = require('../controllers/feeController');

// Categories
router.get('/categories', protect, getCategories);
router.post('/categories', protect, authorize('admin'), createCategory);
router.put('/categories/:id', protect, authorize('admin'), updateCategory);

// Structures (Strictly Admin only for all mutations)
router.get('/structures', protect, getStructures);
router.post('/structures', protect, authorize('admin'), createStructure);
router.post('/demo-structures', protect, authorize('admin'), generateDemoFeeStructures);
router.put('/structures/:id', protect, authorize('admin'), updateStructure);
router.delete('/structures/:id', protect, authorize('admin'), deleteStructure);

// Demands
router.get('/demands', protect, getDemands);
router.post('/demands', protect, authorize('admin', 'accountant'), createDemand);

module.exports = router;

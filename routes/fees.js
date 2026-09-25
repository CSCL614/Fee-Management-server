const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getCategories, createCategory, updateCategory,
  getStructures, createStructure, updateStructure,
  getDemands, createDemand
} = require('../controllers/feeController');

// Categories
router.get('/categories', protect, getCategories);
router.post('/categories', protect, authorize('admin', 'accountant'), createCategory);
router.put('/categories/:id', protect, authorize('admin', 'accountant'), updateCategory);

// Structures
router.get('/structures', protect, getStructures);
router.post('/structures', protect, authorize('admin', 'accountant'), createStructure);
router.put('/structures/:id', protect, authorize('admin', 'accountant'), updateStructure);

// Demands
router.get('/demands', protect, getDemands);
router.post('/demands', protect, authorize('admin', 'accountant'), createDemand);

module.exports = router;

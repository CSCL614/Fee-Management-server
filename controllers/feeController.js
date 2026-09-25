const FeeCategory = require('../models/FeeCategory');
const FeeStructure = require('../models/FeeStructure');
const FeeDemand = require('../models/FeeDemand');
const Student = require('../models/Student');
const { createAuditLog, generateId } = require('../utils/helpers');

// ==================== FEE CATEGORIES ====================

// @desc    Get all fee categories
// @route   GET /api/fees/categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await FeeCategory.find().sort({ name: 1 });
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create fee category
// @route   POST /api/fees/categories
exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    const existing = await FeeCategory.findOne({ name });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }

    const category = await FeeCategory.create({ name, description });

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Category Created',
      entity: 'FeeCategory',
      entityId: category._id.toString(),
      description: `Created fee category: ${name}`,
      newValue: { name, description },
      ipAddress: req.ip
    });

    res.status(201).json({ success: true, data: category, message: 'Category created' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update fee category
// @route   PUT /api/fees/categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const category = await FeeCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const oldValue = { name: category.name, status: category.status };

    if (req.body.name) category.name = req.body.name;
    if (req.body.description !== undefined) category.description = req.body.description;
    if (req.body.status) category.status = req.body.status;

    await category.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Category Updated',
      entity: 'FeeCategory',
      entityId: category._id.toString(),
      description: `Updated fee category: ${category.name}`,
      oldValue,
      newValue: { name: category.name, status: category.status },
      reason: req.body.reason || 'Category update',
      ipAddress: req.ip
    });

    res.json({ success: true, data: category, message: 'Category updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==================== FEE STRUCTURES ====================

// @desc    Get fee structures
// @route   GET /api/fees/structures
exports.getStructures = async (req, res) => {
  try {
    const { course, level, year, academicYear } = req.query;
    const filter = { status: 'active' };
    if (course) filter.course = course;
    if (level) filter.level = level;
    if (year) filter.year = year;
    if (academicYear) filter.academicYear = academicYear;

    const structures = await FeeStructure.find(filter).sort({ course: 1, year: 1, category: 1 });
    res.json({ success: true, data: structures });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create fee structure
// @route   POST /api/fees/structures
exports.createStructure = async (req, res) => {
  try {
    const { course, level, year, academicYear, category, amount } = req.body;

    // Check for duplicate
    const existing = await FeeStructure.findOne({ course, level, year, academicYear, category, status: 'active' });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Fee structure already exists for this combination'
      });
    }

    const feeId = await generateId(FeeStructure, 'FEE', 'feeId');

    const structure = await FeeStructure.create({
      feeId,
      course,
      level,
      year,
      academicYear,
      category,
      amount: parseFloat(amount)
    });

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Structure Created',
      entity: 'FeeStructure',
      entityId: feeId,
      description: `Created fee structure: ${course} ${level} ${year} ${academicYear} - ${category}: ₹${amount}`,
      newValue: { course, level, year, academicYear, category, amount },
      ipAddress: req.ip
    });

    res.status(201).json({ success: true, data: structure, message: 'Fee structure created' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update fee structure
// @route   PUT /api/fees/structures/:id
exports.updateStructure = async (req, res) => {
  try {
    const structure = await FeeStructure.findOne({ feeId: req.params.id });
    if (!structure) {
      return res.status(404).json({ success: false, message: 'Fee structure not found' });
    }

    const oldValue = { amount: structure.amount, status: structure.status };

    if (req.body.amount !== undefined) structure.amount = parseFloat(req.body.amount);
    if (req.body.status) structure.status = req.body.status;

    await structure.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Structure Updated',
      entity: 'FeeStructure',
      entityId: structure.feeId,
      description: `Updated fee structure: ${structure.course} ${structure.category}`,
      oldValue,
      newValue: { amount: structure.amount, status: structure.status },
      reason: req.body.reason || 'Fee structure update',
      ipAddress: req.ip
    });

    res.json({ success: true, data: structure, message: 'Fee structure updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==================== FEE DEMANDS ====================

// @desc    Get fee demands
// @route   GET /api/fees/demands
exports.getDemands = async (req, res) => {
  try {
    const { studentId, academicYear } = req.query;
    const filter = { status: 'active' };
    if (studentId) filter.studentId = studentId;
    if (academicYear) filter.academicYear = academicYear;

    const demands = await FeeDemand.find(filter)
      .populate('student', 'name admissionNo course level')
      .sort({ academicYear: -1 });

    res.json({ success: true, data: demands });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create fee demand for a student
// @route   POST /api/fees/demands
exports.createDemand = async (req, res) => {
  try {
    const { studentId, academicYear, year, categories } = req.body;

    const student = await Student.findOne({ studentId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Check for existing demand
    const existing = await FeeDemand.findOne({
      student: student._id,
      academicYear,
      status: 'active'
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Fee demand already exists for this student and academic year'
      });
    }

    const totalDemand = categories.reduce((sum, c) => sum + parseFloat(c.amount), 0);

    const demand = await FeeDemand.create({
      student: student._id,
      studentId: student.studentId,
      academicYear,
      year: year || student.currentYear,
      course: student.course,
      level: student.level,
      categories: categories.map(c => ({
        category: c.category,
        amount: parseFloat(c.amount)
      })),
      totalDemand,
      createdBy: req.user._id
    });

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Demand Created',
      entity: 'FeeDemand',
      entityId: demand._id.toString(),
      description: `Created fee demand of ₹${totalDemand} for ${student.name} (${academicYear})`,
      newValue: { studentId, academicYear, totalDemand, categories },
      ipAddress: req.ip
    });

    res.status(201).json({ success: true, data: demand, message: 'Fee demand created' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

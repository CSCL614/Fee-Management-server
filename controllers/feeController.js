const FeeCategory = require('../models/FeeCategory');
const FeeStructure = require('../models/FeeStructure');
const FeeDemand = require('../models/FeeDemand');
const Student = require('../models/Student');
const Course = require('../models/Course');
const AcademicYear = require('../models/AcademicYear');
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
    const { course, level, year, academicYear, search } = req.query;
    const filter = { status: 'active' };
    if (course) filter.course = new RegExp(`^${course.trim()}$`, 'i');
    if (level) filter.level = new RegExp(`^${level.trim()}$`, 'i');
    if (year) filter.year = new RegExp(`^${year.trim()}$`, 'i');
    if (academicYear) filter.academicYear = academicYear;

    if (search && search.trim()) {
      const searchTokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const tokenRegexes = searchTokens.map(t => new RegExp(t, 'i'));
      filter.$and = tokenRegexes.map(r => ({
        $or: [
          { course: r },
          { level: r },
          { year: r },
          { academicYear: r },
          { category: r }
        ]
      }));
    }

    const structures = await FeeStructure.find(filter).sort({ course: 1, year: 1, category: 1 });
    res.json({ success: true, data: structures });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Helper to sync fee structure changes with enrolled students
const escapeRegex = (s) => (s ? s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : '');

async function syncStructureWithStudents(course, level, year, academicYear, adminUser) {
  try {
    if (!course || !year || !academicYear) return;

    const courseRegex = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
    const students = await Student.find({
      $or: [
        { course: courseRegex },
        { specialization: courseRegex }
      ],
      currentYear: new RegExp(`^${escapeRegex(year.trim())}$`, 'i'),
      currentAcademicYear: academicYear.trim(),
      status: 'Active'
    });

    if (students.length === 0) return;

    // Get all current active fee structure items for this course, year, and academicYear
    const structures = await FeeStructure.find({
      course: courseRegex,
      year: new RegExp(`^${escapeRegex(year.trim())}$`, 'i'),
      academicYear: academicYear.trim(),
      status: 'active'
    });

    const now = new Date();
    const categoriesFromStructure = structures.map(fs => ({
      category: fs.category,
      amount: fs.amount,
      frequency: fs.frequency || 'ANNUAL',
      semester: fs.semester || null,
      activationDate: fs.activationDate || null,
      dueDate: fs.dueDate || null,
      status: (fs.activationDate && new Date(fs.activationDate) > now) ? 'upcoming' : 'active'
    }));

    for (const student of students) {
      let demand = await FeeDemand.findOne({
        student: student._id,
        academicYear: academicYear.trim(),
        year: year.trim(),
        status: 'active'
      });

      if (demand) {
        // Update categories: replace matching ones or append new terms
        const updatedCategories = [...demand.categories];
        for (const item of categoriesFromStructure) {
          const idx = updatedCategories.findIndex(c =>
            c.category.toLowerCase() === item.category.toLowerCase() &&
            (c.semester || '').toString() === (item.semester || '').toString()
          );
          if (idx >= 0) {
            updatedCategories[idx].amount = item.amount;
            updatedCategories[idx].frequency = item.frequency;
            updatedCategories[idx].activationDate = item.activationDate;
            updatedCategories[idx].dueDate = item.dueDate;
          } else {
            updatedCategories.push(item);
          }
        }
        demand.categories = updatedCategories;
        demand.totalDemand = updatedCategories.reduce((sum, c) => sum + c.amount, 0);
        await demand.save();
      } else if (categoriesFromStructure.length > 0) {
        // Create new demand
        const totalDemand = categoriesFromStructure.reduce((sum, c) => sum + c.amount, 0);
        await FeeDemand.create({
          student: student._id,
          studentId: student.studentId,
          academicYear: academicYear.trim(),
          year: year.trim(),
          course: student.course,
          level: student.level,
          categories: categoriesFromStructure,
          totalDemand,
          createdBy: adminUser?._id
        });
      }
    }
  } catch (err) {
    console.error('Error syncing structure with students:', err);
  }
}

// @desc    Create fee structure (supports single term or batch terms)
// @route   POST /api/fees/structures
exports.createStructure = async (req, res) => {
  try {
    const {
      course,
      level,
      year,
      academicYear,
      items,
      category,
      amount,
      frequency = 'ANNUAL',
      semester = null,
      activationDate = null,
      dueDate = null
    } = req.body;

    if (!course || !year || !academicYear) {
      return res.status(400).json({ success: false, message: 'Course, year, and academic year are required' });
    }

    // Determine level if missing: B.Sc & B.Com = UG, M.Sc = PG
    const derivedLevel = level || (course.toLowerCase().includes('m.sc') || course.toLowerCase().includes('mba') || course.toLowerCase().includes('mca') ? 'PG' : 'UG');

    const createdStructures = [];

    // If items array is provided (multi-term support)
    const termsToProcess = Array.isArray(items) && items.length > 0
      ? items
      : [{ category, amount, frequency, semester, activationDate, dueDate }];

    for (const term of termsToProcess) {
      if (!term.category || term.amount === undefined || term.amount === '') continue;

      const trimmedCategory = term.category.trim();
      const termAmount = parseFloat(term.amount);
      const termSem = term.semester || null;

      // Check for duplicate
      let structure = await FeeStructure.findOne({
        course: new RegExp(`^${escapeRegex(course.trim())}$`, 'i'),
        year: new RegExp(`^${escapeRegex(year.trim())}$`, 'i'),
        academicYear: academicYear.trim(),
        category: new RegExp(`^${escapeRegex(trimmedCategory)}$`, 'i'),
        semester: termSem,
        status: 'active'
      });

      if (structure) {
        // Update existing amount
        structure.amount = termAmount;
        if (term.frequency) structure.frequency = term.frequency;
        if (term.activationDate) structure.activationDate = new Date(term.activationDate);
        if (term.dueDate) structure.dueDate = new Date(term.dueDate);
        await structure.save();
        createdStructures.push(structure);
      } else {
        const feeId = await generateId(FeeStructure, 'FEE', 'feeId');
        structure = await FeeStructure.create({
          feeId,
          course: course.trim(),
          level: derivedLevel,
          year: year.trim(),
          academicYear: academicYear.trim(),
          category: trimmedCategory,
          frequency: term.frequency || 'ANNUAL',
          semester: termSem,
          activationDate: term.activationDate ? new Date(term.activationDate) : null,
          dueDate: term.dueDate ? new Date(term.dueDate) : null,
          amount: termAmount
        });

        await createAuditLog({
          user: req.user._id,
          userName: req.user.name,
          userRole: req.user.role,
          action: 'Fee Structure Created',
          entity: 'FeeStructure',
          entityId: feeId,
          description: `Created fee structure: ${course} ${derivedLevel} ${year} ${academicYear} - ${trimmedCategory}: ₹${termAmount}`,
          newValue: structure.toObject(),
          ipAddress: req.ip
        });

        createdStructures.push(structure);
      }
    }

    // Automatically sync with enrolled students in this course & year
    await syncStructureWithStudents(course, derivedLevel, year, academicYear, req.user);

    res.status(201).json({
      success: true,
      data: createdStructures.length === 1 ? createdStructures[0] : createdStructures,
      message: 'Fee structure term(s) saved and synced with enrolled students'
    });
  } catch (error) {
    console.error('Create structure error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
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
    if (req.body.category) structure.category = req.body.category.trim();

    await structure.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Structure Updated',
      entity: 'FeeStructure',
      entityId: structure.feeId,
      description: `Updated fee structure: ${structure.course} ${structure.category} amount to ₹${structure.amount}`,
      oldValue,
      newValue: { amount: structure.amount, status: structure.status, category: structure.category },
      reason: req.body.reason || 'Fee structure update',
      ipAddress: req.ip
    });

    // Sync with enrolled students
    await syncStructureWithStudents(structure.course, structure.level, structure.year, structure.academicYear, req.user);

    res.json({ success: true, data: structure, message: 'Fee structure updated and synced' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete fee structure
// @route   DELETE /api/fees/structures/:id
exports.deleteStructure = async (req, res) => {
  try {
    const structure = await FeeStructure.findOne({ feeId: req.params.id });
    if (!structure) {
      return res.status(404).json({ success: false, message: 'Fee structure not found' });
    }

    structure.status = 'inactive';
    await structure.save();

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Structure Deleted',
      entity: 'FeeStructure',
      entityId: structure.feeId,
      description: `Deleted fee structure: ${structure.course} ${structure.year} - ${structure.category}`,
      oldValue: { status: 'active' },
      newValue: { status: 'inactive' },
      reason: req.body?.reason || 'Fee structure deletion',
      ipAddress: req.ip
    });

    // Sync with enrolled students
    await syncStructureWithStudents(structure.course, structure.level, structure.year, structure.academicYear, req.user);

    res.json({ success: true, message: 'Fee structure deleted and synced' });
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

    const now = new Date();

    // Fetch all existing active fee demands for this student and academic year
    const existingDemand = await FeeDemand.findOne({
      student: student._id,
      academicYear,
      status: 'active'
    });

    const existingCategories = existingDemand ? existingDemand.categories : [];

    // Filter categories to prevent duplicates based on business rules
    const validCategories = [];
    for (const cat of categories) {
      const catName = cat.category.trim();

      // Rule: UDF Fee is charged ONCE per student per academic year
      if (catName.toLowerCase().includes('udf')) {
        const hasUDF = existingCategories.some(c => c.category.toLowerCase().includes('udf'));
        if (hasUDF) continue; // Skip duplicate UDF
      }

      // Rule: Exam Fee & Practical Fee charged per semester per academic year
      if (catName.toLowerCase().includes('exam') || catName.toLowerCase().includes('practical')) {
        const hasDup = existingCategories.some(c =>
          c.category.toLowerCase() === catName.toLowerCase() &&
          (c.semester || '').toString() === (cat.semester || '').toString()
        );
        if (hasDup) continue; // Skip duplicate semester fee
      }

      const actDate = cat.activationDate ? new Date(cat.activationDate) : null;

      validCategories.push({
        category: cat.category,
        amount: parseFloat(cat.amount),
        frequency: cat.frequency || 'ANNUAL',
        semester: cat.semester || null,
        activationDate: actDate,
        dueDate: cat.dueDate ? new Date(cat.dueDate) : null,
        status: actDate && actDate > now ? 'upcoming' : 'active'
      });
    }

    if (validCategories.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No new fee categories to add or duplicate fee demands detected.'
      });
    }

    let demand;
    if (existingDemand) {
      existingDemand.categories.push(...validCategories);
      existingDemand.totalDemand = existingDemand.categories.reduce((sum, c) => sum + c.amount, 0);
      demand = await existingDemand.save();
    } else {
      const totalDemand = validCategories.reduce((sum, c) => sum + c.amount, 0);
      demand = await FeeDemand.create({
        student: student._id,
        studentId: student.studentId,
        academicYear,
        year: year || student.currentYear,
        course: student.course,
        level: student.level,
        categories: validCategories,
        totalDemand,
        createdBy: req.user._id
      });
    }

    await createAuditLog({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'Fee Demand Created',
      entity: 'FeeDemand',
      entityId: demand._id.toString(),
      description: `Created fee demand for ${student.name} (${academicYear})`,
      newValue: { studentId, academicYear, categories: validCategories },
      ipAddress: req.ip
    });

    res.status(201).json({ success: true, data: demand, message: 'Fee demand updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// @desc    Generate standard DEMO Fee Structures for Academic Year 2026-27
// @route   POST /api/fees/demo-structures
// @access  Admin only
exports.generateDemoFeeStructures = async (req, res) => {
  try {
    const academicYear = req.body.academicYear || '2026-27';

    // 1. Ensure core Fee Categories exist with correct frequency
    const standardCategories = [
      { name: 'Tuition Fee', description: 'Annual Tuition Fee (DEMO)', frequency: 'ANNUAL', isDefault: true },
      { name: 'UDF Fee', description: 'User Development Fee charged annually per student (DEMO)', frequency: 'ANNUAL', isDefault: true },
      { name: 'Exam Fee', description: 'Semester Examination Fee (DEMO)', frequency: 'SEMESTER', isDefault: true },
      { name: 'Practical Fee', description: 'Semester Practical and Laboratory Fee (DEMO)', frequency: 'SEMESTER', isDefault: true },
      { name: 'Admission Fee', description: 'One-time Admission Fee for new admissions (DEMO)', frequency: 'ONE_TIME', isDefault: true }
    ];

    for (const cat of standardCategories) {
      const existingCat = await FeeCategory.findOne({ name: new RegExp(`^${escapeRegex(cat.name)}$`, 'i') });
      if (!existingCat) {
        await FeeCategory.create(cat);
      } else if (existingCat.frequency !== cat.frequency) {
        existingCat.frequency = cat.frequency;
        await existingCat.save();
      }
    }

    // 2. Ensure academic year exists in AcademicYear collection
    const ayDoc = await AcademicYear.findOne({ year: academicYear });
    if (!ayDoc) {
      await AcademicYear.create({
        year: academicYear,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        isCurrent: true,
        status: 'active'
      });
    }

    // 3. Expected Courses in Catalog
    const EXPECTED_COURSES = [
      { degree: 'B.Sc', specialization: 'Chemistry', courseName: 'B.Sc Chemistry', duration: 3, level: 'UG' },
      { degree: 'B.Sc', specialization: 'Computer Science', courseName: 'B.Sc Computer Science', duration: 3, level: 'UG' },
      { degree: 'B.Sc', specialization: 'Zoology', courseName: 'B.Sc Zoology', duration: 3, level: 'UG' },
      { degree: 'B.Com', specialization: 'Computer Application', courseName: 'B.Com Computer Application', duration: 3, level: 'UG' },
      { degree: 'M.Sc', specialization: 'Organic Chemistry', courseName: 'M.Sc Organic Chemistry', duration: 2, level: 'PG' }
    ];

    for (const c of EXPECTED_COURSES) {
      let courseDoc = await Course.findOne({
        degree: new RegExp(`^${escapeRegex(c.degree)}$`, 'i'),
        specialization: new RegExp(`^${escapeRegex(c.specialization)}$`, 'i')
      });
      if (!courseDoc) {
        const courseId = await generateId(Course, 'CRS', 'courseId');
        await Course.create({
          courseId,
          degree: c.degree,
          specialization: c.specialization,
          courseName: c.courseName,
          duration: c.duration,
          level: c.level,
          status: 'active'
        });
      }
    }

    // 4. Generate demo fee terms per course and year of study
    let createdCount = 0;
    let reusedCount = 0;
    const structuresConfigured = [];

    for (const c of EXPECTED_COURSES) {
      const years = c.duration === 2 ? ['1st Year', '2nd Year'] : ['1st Year', '2nd Year', '3rd Year'];

      for (const year of years) {
        // Base annual & semester fee terms
        const terms = [
          {
            category: 'Tuition Fee',
            amount: 30000,
            frequency: 'ANNUAL',
            semester: null,
            activationDate: new Date('2026-06-01'),
            dueDate: new Date('2026-07-31')
          },
          {
            category: 'UDF Fee',
            amount: 1000,
            frequency: 'ANNUAL',
            semester: null,
            activationDate: new Date('2026-06-01'),
            dueDate: new Date('2026-07-31')
          },
          {
            category: 'Exam Fee',
            amount: 1000,
            frequency: 'SEMESTER',
            semester: 'Semester 1',
            activationDate: new Date('2026-10-01'),
            dueDate: new Date('2026-10-31')
          },
          {
            category: 'Exam Fee',
            amount: 1000,
            frequency: 'SEMESTER',
            semester: 'Semester 2',
            activationDate: new Date('2027-03-01'),
            dueDate: new Date('2027-03-31')
          },
          {
            category: 'Practical Fee',
            amount: 2000,
            frequency: 'SEMESTER',
            semester: 'Semester 1',
            activationDate: new Date('2026-10-01'),
            dueDate: new Date('2026-10-31')
          },
          {
            category: 'Practical Fee',
            amount: 2000,
            frequency: 'SEMESTER',
            semester: 'Semester 2',
            activationDate: new Date('2027-03-01'),
            dueDate: new Date('2027-03-31')
          }
        ];

        // One-time Admission Fee for 1st Year only
        if (year === '1st Year') {
          terms.push({
            category: 'Admission Fee',
            amount: 2000,
            frequency: 'ONE_TIME',
            semester: null,
            activationDate: new Date('2026-06-01'),
            dueDate: new Date('2026-07-31')
          });
        }

        for (const term of terms) {
          const query = {
            course: new RegExp(`^${escapeRegex(c.courseName)}$`, 'i'),
            year: new RegExp(`^${escapeRegex(year)}$`, 'i'),
            academicYear: academicYear,
            category: new RegExp(`^${escapeRegex(term.category)}$`, 'i'),
            semester: term.semester,
            status: 'active'
          };

          let structure = await FeeStructure.findOne(query);

          if (structure) {
            structure.amount = term.amount;
            structure.frequency = term.frequency;
            structure.activationDate = term.activationDate;
            structure.dueDate = term.dueDate;
            structure.isDemo = true;
            structure.remarks = `DEMO Fee Structure (Fictional Test Data for AY ${academicYear})`;
            await structure.save();
            reusedCount++;
            structuresConfigured.push(structure);
          } else {
            const feeId = await generateId(FeeStructure, 'FEE', 'feeId');
            structure = await FeeStructure.create({
              feeId,
              course: c.courseName,
              level: c.level,
              year,
              academicYear,
              category: term.category,
              amount: term.amount,
              frequency: term.frequency,
              semester: term.semester,
              activationDate: term.activationDate,
              dueDate: term.dueDate,
              status: 'active',
              isDemo: true,
              remarks: `DEMO Fee Structure (Fictional Test Data for AY ${academicYear})`
            });
            createdCount++;
            structuresConfigured.push(structure);
          }
        }

        // Automatically sync with any enrolled students in this course & year
        await syncStructureWithStudents(c.courseName, c.level, year, academicYear, req.user);
      }
    }

    // Log to AuditLog
    await createAuditLog({
      user: req.user?._id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      action: 'Generate Demo Fee Structures',
      entity: 'FeeStructure',
      description: `Configured standard DEMO fee structures for AY ${academicYear}: ${createdCount} created, ${reusedCount} updated/reused across 5 courses (${structuresConfigured.length} total terms).`,
      newValue: { academicYear, createdCount, reusedCount, totalDemoTerms: structuresConfigured.length },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Successfully configured standard DEMO fee structures for Academic Year ${academicYear} (${structuresConfigured.length} terms across 5 courses)`,
      data: {
        academicYear,
        createdCount,
        reusedCount,
        totalStructures: structuresConfigured.length,
        coursesConfigured: EXPECTED_COURSES.map(c => c.courseName)
      }
    });
  } catch (error) {
    console.error('Generate demo fee structures error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error generating demo fee structures' });
  }
};

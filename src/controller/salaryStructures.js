const db = require("../models");
const { v4: uuidv4 } = require("uuid");

// Generate salary structure code
const generateStructureCode = async (facilityId) => {
  const count = await db.salary_structures.count({
    where: { facilityId },
  });
  return `SS-${String(count + 1).padStart(4, "0")}`;
};

// Create new salary structure
exports.createSalaryStructure = async (req, res) => {
  try {
    const {
      structureName,
      structureCode,
      basicSalary,
      allowances = {},
      deductions = {},
      overtimeRate = 1.5,
      payeRate = 0,
      pensionRate = 0,
      description,
      accountCode,
      facilityId,
      createdBy,
    } = req.body;

    // Check if facilityId is provided
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId is missing in request body"
      });
    }

    // Use submitted structure code or generate one if not provided
    let finalStructureCode = structureCode;
    if (!finalStructureCode || finalStructureCode.trim() === '') {
      finalStructureCode = await generateStructureCode(facilityId);
    }

    // Check if structure code already exists for this facility
    const existingStructure = await db.salary_structures.findOne({
      where: { 
        structureCode: finalStructureCode,
        facilityId 
      },
    });

    if (existingStructure) {
      return res.status(400).json({
        success: false,
        message: "Structure code already exists",
        error: `Structure code '${finalStructureCode}' is already in use for this facility`
      });
    }

    const salaryStructure = await db.salary_structures.create({
      id: uuidv4(),
      structureName,
      structureCode: finalStructureCode,
      facilityId,
      basicSalary: parseFloat(basicSalary),
      allowances,
      deductions,
      overtimeRate: parseFloat(overtimeRate),
      payeRate: parseFloat(payeRate),
      pensionRate: parseFloat(pensionRate),
      description,
      accountCode,
      createdBy,
      status: "Active",
    });

    res.status(201).json({
      success: true,
      message: "Salary structure created successfully",
      data: salaryStructure,
    });
  } catch (error) {
    console.error("Error creating salary structure:", error);
    res.status(500).json({
      success: false,
      message: "Error creating salary structure",
      error: error.message,
    });
  }
};

// Get all salary structures
exports.getAllSalaryStructures = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, facilityId } = req.query;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }
    
    const offset = (page - 1) * limit;

    let whereClause = { facilityId };

    if (search) {
      whereClause[db.Sequelize.Op.or] = [
        { structureName: { [db.Sequelize.Op.like]: `%${search}%` } },
        { structureCode: { [db.Sequelize.Op.like]: `%${search}%` } },
        { description: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    if (status) {
      whereClause.status = status;
    }

    const { count, rows } = await db.salary_structures.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.employees,
          as: "employees",
          attributes: ["id", "employeeId", "firstName", "lastName"],
          required: false,
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        salaryStructures: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching salary structures:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching salary structures",
      error: error.message,
    });
  }
};

// Get salary structure by ID
exports.getSalaryStructureById = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId } = req.query;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }

    const salaryStructure = await db.salary_structures.findOne({
      where: { id, facilityId },
      include: [
        {
          model: db.employees,
          as: "employees",
          attributes: ["id", "employeeId", "firstName", "lastName", "designation"],
          required: false,
        },
      ],
    });

    if (!salaryStructure) {
      return res.status(404).json({
        success: false,
        message: "Salary structure not found",
      });
    }

    res.json({
      success: true,
      data: salaryStructure,
    });
  } catch (error) {
    console.error("Error fetching salary structure:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching salary structure",
      error: error.message,
    });
  }
};

// Update salary structure
exports.updateSalaryStructure = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, updatedBy, ...updateData } = req.body;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId is missing in request body"
      });
    }

    const salaryStructure = await db.salary_structures.findOne({
      where: { id, facilityId },
    });

    if (!salaryStructure) {
      return res.status(404).json({
        success: false,
        message: "Salary structure not found",
      });
    }

    // Check if structure code is being updated and if it already exists
    if (updateData.structureCode && updateData.structureCode !== salaryStructure.structureCode) {
      const existingStructure = await db.salary_structures.findOne({
        where: { 
          structureCode: updateData.structureCode,
          facilityId,
          id: { [db.Sequelize.Op.ne]: id } // Exclude current record
        },
      });

      if (existingStructure) {
        return res.status(400).json({
          success: false,
          message: "Structure code already exists",
          error: `Structure code '${updateData.structureCode}' is already in use for this facility`
        });
      }
    }

    // Convert numeric fields
    if (updateData.basicSalary) updateData.basicSalary = parseFloat(updateData.basicSalary);
    if (updateData.overtimeRate) updateData.overtimeRate = parseFloat(updateData.overtimeRate);
    if (updateData.payeRate) updateData.payeRate = parseFloat(updateData.payeRate);
    if (updateData.pensionRate) updateData.pensionRate = parseFloat(updateData.pensionRate);

    const updatedSalaryStructure = await salaryStructure.update({
      ...updateData,
      updatedBy,
    });

    res.json({
      success: true,
      message: "Salary structure updated successfully",
      data: updatedSalaryStructure,
    });
  } catch (error) {
    console.error("Error updating salary structure:", error);
    res.status(500).json({
      success: false,
      message: "Error updating salary structure",
      error: error.message,
    });
  }
};

// Deactivate salary structure
exports.deactivateSalaryStructure = async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityId, updatedBy } = req.body;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId is missing in request body"
      });
    }

    const salaryStructure = await db.salary_structures.findOne({
      where: { id, facilityId },
    });

    if (!salaryStructure) {
      return res.status(404).json({
        success: false,
        message: "Salary structure not found",
      });
    }

    // Check if any employees are using this salary structure
    const employeeCount = await db.employees.count({
      where: { salaryStructureId: id, facilityId },
    });

    if (employeeCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate salary structure. It is currently assigned to employees.",
        error: `${employeeCount} employees are using this salary structure`,
      });
    }

    await salaryStructure.update({
      status: "Inactive",
      updatedBy,
    });

    res.json({
      success: true,
      message: "Salary structure deactivated successfully",
    });
  } catch (error) {
    console.error("Error deactivating salary structure:", error);
    res.status(500).json({
      success: false,
      message: "Error deactivating salary structure",
      error: error.message,
    });
  }
};

// Get salary structure summary
exports.getSalaryStructureSummary = async (req, res) => {
  try {
    const { facilityId } = req.query;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }

    const totalStructures = await db.salary_structures.count({
      where: { facilityId },
    });

    const activeStructures = await db.salary_structures.count({
      where: { facilityId, status: "Active" },
    });

    const inactiveStructures = await db.salary_structures.count({
      where: { facilityId, status: "Inactive" },
    });

    const totalEmployees = await db.employees.count({
      where: { facilityId },
      include: [
        {
          model: db.salary_structures,
          as: "salaryStructure",
          required: true,
        },
      ],
    });

    res.json({
      success: true,
      data: {
        totalStructures,
        activeStructures,
        inactiveStructures,
        totalEmployees,
      },
    });
  } catch (error) {
    console.error("Error fetching salary structure summary:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching salary structure summary",
      error: error.message,
    });
  }
};

// Bulk create salary structures from Excel upload
exports.bulkCreateSalaryStructures = async (req, res) => {
  const { structures, facilityId, createdBy } = req.body;

  if (!facilityId) {
    return res.status(400).json({ success: false, message: "facilityId is required" });
  }
  if (!Array.isArray(structures) || structures.length === 0) {
    return res.status(400).json({ success: false, message: "structures array is required" });
  }

  const results = { created: 0, failed: 0, errors: [] };

  for (let i = 0; i < structures.length; i++) {
    const row = structures[i];
    try {
      if (!row.structureName) {
        results.failed++;
        results.errors.push({ row: i + 2, message: "structureName is required" });
        continue;
      }
      const code = row.structureCode || (await generateStructureCode(facilityId));
      const existing = await db.salary_structures.findOne({ where: { structureCode: code, facilityId } });
      if (existing) {
        results.failed++;
        results.errors.push({ row: i + 2, message: `Structure code '${code}' already exists` });
        continue;
      }
      // Parse allowances/deductions — accept JSON string or plain object
      let allowances = {};
      let deductions = {};
      try { allowances = typeof row.allowances === "string" ? JSON.parse(row.allowances) : (row.allowances || {}); } catch (_) {}
      try { deductions = typeof row.deductions === "string" ? JSON.parse(row.deductions) : (row.deductions || {}); } catch (_) {}

      await db.salary_structures.create({
        id: uuidv4(),
        structureName: row.structureName,
        structureCode: code,
        basicSalary: parseFloat(row.basicSalary) || 0,
        paymentType: row.paymentType || "Monthly",
        allowances: JSON.stringify(allowances),
        deductions: JSON.stringify(deductions),
        overtimeRate: parseFloat(row.overtimeRate) || 1.5,
        payeRate: parseFloat(row.payeRate) || 0,
        pensionRate: parseFloat(row.pensionRate) || 0,
        description: row.description || null,
        accountCode: row.accountCode || null,
        facilityId,
        createdBy: createdBy || null,
        status: "Active",
      });
      results.created++;
    } catch (err) {
      results.failed++;
      results.errors.push({ row: i + 2, message: err.message });
    }
  }

  res.json({
    success: true,
    message: `Bulk import complete: ${results.created} created, ${results.failed} failed`,
    data: results,
  });
};

const db = require("../models");
const { v4: uuidv4 } = require("uuid");

const parseIsTaxable = (value, type = "allowance") => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return String(type).toLowerCase() === "allowance";
  }
  const v = String(value).trim().toLowerCase();
  if (["yes", "y", "true", "1", "taxable"].includes(v)) return true;
  if (["no", "n", "false", "0", "non-taxable", "not taxable", "non taxable"].includes(v)) {
    return false;
  }
  return String(type).toLowerCase() === "allowance";
};

/** Extract account head from "Description (5100)" or plain "5100". */
const parseAccountCode = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parenMatch = raw.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) return parenMatch[1].trim();
  return raw;
};

/** Chart-of-accounts source of truth is account_category (same as UI picker). */
const accountCodeExistsForFacility = async (facilityId, accountCode) => {
  if (!accountCode) return false;
  const code = String(accountCode).trim();
  const categoryAccount = await db.AccountCategory.findOne({
    where: { code, facilityId, isActive: true },
    attributes: ["code"],
  });
  return Boolean(categoryAccount);
};

const loadFacilityAccountCodes = async (facilityId) => {
  const categories = await db.AccountCategory.findAll({
    where: { facilityId, isActive: true },
    attributes: ["code"],
  });
  return new Set(categories.map((c) => String(c.code).trim()));
};

const isRoleBasedAllocation = (row) =>
  row.isRoleBased === true ||
  String(row.isRoleBased || "")
    .toLowerCase()
    .includes("role") ||
  String(row.isRoleBased || "").toLowerCase() === "true";

const resolveAllocationId = (row, isRoleBased) => {
  const raw =
    row.id ||
    row["id"] ||
    (isRoleBased ? row.roleId || row["Role ID"] : null) ||
    (!isRoleBased ? row.salaryStructureId || row["Structure ID"] || row["Salary Structure ID"] : null) ||
    "";
  return String(raw).trim();
};

// Create new allowance or deduction
exports.createAllowance = async (req, res) => {
  try {
    const {
      name,
      type,
      amount,
      calculationType,
      description,
      isRoleBased,
      roleId,
      roleName,
      salaryStructureId,
      salaryStructureName,
      accountCode,
      isTaxable,
      facilityId,
      createdBy,
    } = req.body;

    // Validate required fields
    if (!name || !type || !amount || !calculationType || !facilityId || !createdBy) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        error: "name, type, amount, calculationType, facilityId, and createdBy are required"
      });
    }

    // Validate type
    if (!["allowance", "deduction"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid type",
        error: "type must be either 'allowance' or 'deduction'"
      });
    }

    // Validate calculation type
    if (!["fixed", "percentage"].includes(calculationType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid calculation type",
        error: "calculationType must be either 'fixed' or 'percentage'"
      });
    }

    // Validate accounting ledger (accountCode) exists (when provided)
    const normalizedAccountCode =
      accountCode === undefined || accountCode === null
        ? null
        : String(accountCode).trim();
    if (normalizedAccountCode) {
      const exists = await accountCodeExistsForFacility(facilityId, normalizedAccountCode);
      if (!exists) {
        return res.status(400).json({
          success: false,
          message: "Invalid accountCode",
          error: `Account code '${normalizedAccountCode}' does not exist for this facility`,
        });
      }
    }

    // If role-based, validate role fields
    if (isRoleBased && !roleId && !roleName) {
      return res.status(400).json({
        success: false,
        message: "Role fields are required for role-based allowances/deductions",
        error: "roleId and roleName are required when isRoleBased is true"
      });
    }

    // If salary structure based, validate structure fields
    if (!isRoleBased && (!salaryStructureId || !salaryStructureName)) {
      return res.status(400).json({
        success: false,
        message: "Salary structure fields are required for structure-based allowances/deductions",
        error: "salaryStructureId and salaryStructureName are required when isRoleBased is false"
      });
    }

    const allowance = await db.allowances.create({
      id: uuidv4(),
      name,
      type,
      amount: parseFloat(amount),
      calculationType,
      description,
      isRoleBased: Boolean(isRoleBased),
      roleId: isRoleBased ? roleId : null,
      roleName: isRoleBased ? roleName : null,
      salaryStructureId: !isRoleBased ? salaryStructureId : null,
      salaryStructureName: !isRoleBased ? salaryStructureName : null,
      accountCode: normalizedAccountCode,
      isTaxable:
        type === "allowance"
          ? parseIsTaxable(isTaxable, type)
          : false,
      facilityId,
      createdBy,
      status: "Active",
    });

    res.status(201).json({
      success: true,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} created successfully`,
      data: allowance,
    });
  } catch (error) {
    console.error("Error creating allowance:", error);
    res.status(500).json({
      success: false,
      message: "Error creating allowance/deduction",
      error: error.message,
    });
  }
};

// Get all allowances and deductions
exports.getAllAllowances = async (req, res) => {
  try {
    const { facilityId, type, status, search, page = 1, limit = 50 } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }

    const offset = (page - 1) * limit;
    let whereClause = { facilityId };

    // Filter by type (allowance or deduction)
    if (type && ["allowance", "deduction"].includes(type)) {
      whereClause.type = type;
    }

    // Filter by status
    if (status && ["Active", "Inactive"].includes(status)) {
      whereClause.status = status;
    }

    // Search functionality
    if (search) {
      whereClause[db.Sequelize.Op.or] = [
        { name: { [db.Sequelize.Op.like]: `%${search}%` } },
        { description: { [db.Sequelize.Op.like]: `%${search}%` } },
        { roleName: { [db.Sequelize.Op.like]: `%${search}%` } },
        { salaryStructureName: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows } = await db.allowances.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching allowances:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching allowances/deductions",
      error: error.message,
    });
  }
};

// Get allowance/deduction by ID
exports.getAllowanceById = async (req, res) => {
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

    const allowance = await db.allowances.findOne({
      where: { id, facilityId },
    });

    if (!allowance) {
      return res.status(404).json({
        success: false,
        message: "Allowance/deduction not found",
      });
    }

    res.json({
      success: true,
      data: allowance,
    });
  } catch (error) {
    console.error("Error fetching allowance:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching allowance/deduction",
      error: error.message,
    });
  }
};

// Update allowance/deduction
exports.updateAllowance = async (req, res) => {
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

    const allowance = await db.allowances.findOne({
      where: { id, facilityId },
    });

    if (!allowance) {
      return res.status(404).json({
        success: false,
        message: "Allowance/deduction not found",
      });
    }

    // Validate type if being updated
    if (updateData.type && !["allowance", "deduction"].includes(updateData.type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid type",
        error: "type must be either 'allowance' or 'deduction'"
      });
    }

    // Validate calculation type if being updated
    if (updateData.calculationType && !["fixed", "percentage"].includes(updateData.calculationType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid calculation type",
        error: "calculationType must be either 'fixed' or 'percentage'"
      });
    }

    // Convert amount to float if provided
    if (updateData.amount) {
      updateData.amount = parseFloat(updateData.amount);
    }

    // Convert isRoleBased to boolean if provided
    if (updateData.isRoleBased !== undefined) {
      updateData.isRoleBased = Boolean(updateData.isRoleBased);
    }

    if (updateData.isTaxable !== undefined) {
      const effectiveType = updateData.type || allowance.type;
      updateData.isTaxable =
        effectiveType === "allowance"
          ? parseIsTaxable(updateData.isTaxable, effectiveType)
          : false;
    }

    // Validate accounting ledger (accountCode) exists (when being updated)
    if (updateData.accountCode !== undefined) {
      const normalizedUpdatedAccountCode =
        updateData.accountCode === null || updateData.accountCode === ""
          ? null
          : String(updateData.accountCode).trim();
      updateData.accountCode = normalizedUpdatedAccountCode;

      if (normalizedUpdatedAccountCode) {
        const exists = await accountCodeExistsForFacility(
          facilityId,
          normalizedUpdatedAccountCode,
        );
        if (!exists) {
          return res.status(400).json({
            success: false,
            message: "Invalid accountCode",
            error: `Account code '${normalizedUpdatedAccountCode}' does not exist for this facility`,
          });
        }
      }
    }

    const updatedAllowance = await allowance.update({
      ...updateData,
      updatedBy,
    });

    res.json({
      success: true,
      message: "Allowance/deduction updated successfully",
      data: updatedAllowance,
    });
  } catch (error) {
    console.error("Error updating allowance:", error);
    res.status(500).json({
      success: false,
      message: "Error updating allowance/deduction",
      error: error.message,
    });
  }
};

// Delete allowance/deduction
exports.deleteAllowance = async (req, res) => {
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

    const allowance = await db.allowances.findOne({
      where: { id, facilityId },
    });

    if (!allowance) {
      return res.status(404).json({
        success: false,
        message: "Allowance/deduction not found",
      });
    }

    // Check if allowance/deduction is being used in any payroll
    const payrollUsage = await db.payroll.count({
      where: {
        facilityId,
        [db.Sequelize.Op.or]: [
          { allowances: { [db.Sequelize.Op.like]: `%${id}%` } },
          { deductions: { [db.Sequelize.Op.like]: `%${id}%` } },
        ],
      },
    });

    if (payrollUsage > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete allowance/deduction. It is currently being used in payroll records.",
        error: `${payrollUsage} payroll records are using this allowance/deduction`,
      });
    }

    await allowance.destroy();

    res.json({
      success: true,
      message: "Allowance/deduction deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting allowance:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting allowance/deduction",
      error: error.message,
    });
  }
};

// Get allowances/deductions summary
exports.getAllowancesSummary = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }

    const totalAllowances = await db.allowances.count({
      where: { facilityId, type: "allowance" },
    });

    const totalDeductions = await db.allowances.count({
      where: { facilityId, type: "deduction" },
    });

    const activeAllowances = await db.allowances.count({
      where: { facilityId, type: "allowance", status: "Active" },
    });

    const activeDeductions = await db.allowances.count({
      where: { facilityId, type: "deduction", status: "Active" },
    });

    const roleBasedCount = await db.allowances.count({
      where: { facilityId, isRoleBased: true },
    });

    const structureBasedCount = await db.allowances.count({
      where: { facilityId, isRoleBased: false },
    });

    res.json({
      success: true,
      data: {
        totalAllowances,
        totalDeductions,
        activeAllowances,
        activeDeductions,
        roleBasedCount,
        structureBasedCount,
        total: totalAllowances + totalDeductions,
      },
    });
  } catch (error) {
    console.error("Error fetching allowances summary:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching allowances/deductions summary",
      error: error.message,
    });
  }
};

// Bulk create allowances/deductions from Excel upload (all-or-nothing transaction)
exports.bulkCreateAllowances = async (req, res) => {
  const { allowances, facilityId, createdBy } = req.body;

  if (!facilityId) {
    return res.status(400).json({ success: false, message: "facilityId is required" });
  }
  if (!Array.isArray(allowances) || allowances.length === 0) {
    return res.status(400).json({ success: false, message: "allowances array is required" });
  }

  const errors = [];
  const normalizedRows = [];

  try {
    const [roles, structures, accountCodeSet] = await Promise.all([
      db.Role
        ? db.Role.findAll({
            where: { facilityId },
            attributes: ["id", "name", "status"],
          })
        : [],
      db.salary_structures
        ? db.salary_structures.findAll({
            where: { facilityId },
            attributes: ["id", "structureName", "status"],
          })
        : [],
      loadFacilityAccountCodes(facilityId),
    ]);

    const roleById = new Map(roles.map((r) => [String(r.id), r]));
    const roleByName = new Map(
      roles.map((r) => [String(r.name || "").trim().toLowerCase(), r]),
    );
    const structureById = new Map(structures.map((s) => [String(s.id), s]));

    for (let i = 0; i < allowances.length; i++) {
      const row = allowances[i];
      const rowNum = i + 2;
      const type = (row.type || "").toLowerCase();
      const calculationType = (row.calculationType || "fixed").toLowerCase();

      if (!row.name || !type || row.amount === undefined || row.amount === "") {
        errors.push({ row: rowNum, message: "Component Name, type, and Value are required" });
        continue;
      }
      if (!["allowance", "deduction"].includes(type)) {
        errors.push({ row: rowNum, message: `Invalid type: ${type}` });
        continue;
      }
      if (!["fixed", "percentage"].includes(calculationType)) {
        errors.push({ row: rowNum, message: `Invalid Method: ${calculationType}` });
        continue;
      }

      const accountCode = parseAccountCode(
        row.accountCode || row["Accounting Ledger"] || row["Account Code"],
      );
      if (!accountCode) {
        errors.push({ row: rowNum, message: "Accounting Ledger is required" });
        continue;
      }
      if (!accountCodeSet.has(accountCode)) {
        errors.push({
          row: rowNum,
          message: `Invalid Accounting Ledger '${accountCode}' — account not found for this facility`,
        });
        continue;
      }

      const isRoleBased = isRoleBasedAllocation(row);
      const allocationId = resolveAllocationId(row, isRoleBased);

      if (!allocationId) {
        errors.push({
          row: rowNum,
          message: isRoleBased
            ? "id (Role ID) is required when Basis of Allocation is role"
            : "id (Structure ID) is required when Basis of Allocation is salary structure",
        });
        continue;
      }

      let roleId = null;
      let roleName = null;
      let salaryStructureId = null;
      let salaryStructureName = null;

      if (isRoleBased) {
        let role =
          roleById.get(allocationId) ||
          roleById.get(String(Number(allocationId))) ||
          roleByName.get(allocationId.toLowerCase());

        if (!role && row.roleName) {
          role = roleByName.get(String(row.roleName).trim().toLowerCase());
        }

        if (!role) {
          errors.push({
            row: rowNum,
            message: `Invalid id '${allocationId}' — role not found for this facility`,
          });
          continue;
        }
        if (role.status && role.status !== "active") {
          errors.push({
            row: rowNum,
            message: `Role '${role.name}' is inactive`,
          });
          continue;
        }
        roleId = String(role.id);
        roleName = role.name;
      } else {
        const structure = structureById.get(allocationId);
        if (!structure) {
          errors.push({
            row: rowNum,
            message: `Invalid id '${allocationId}' — salary structure not found for this facility`,
          });
          continue;
        }
        if (structure.status && structure.status !== "Active") {
          errors.push({
            row: rowNum,
            message: `Salary structure '${structure.structureName}' is not active`,
          });
          continue;
        }
        salaryStructureId = structure.id;
        salaryStructureName = structure.structureName;
      }

      normalizedRows.push({
        id: uuidv4(),
        name: String(row.name).trim(),
        type,
        amount: parseFloat(row.amount) || 0,
        calculationType,
        description: row.description || null,
        isRoleBased,
        roleId,
        roleName,
        salaryStructureId,
        salaryStructureName,
        accountCode,
        isTaxable:
          type === "allowance"
            ? parseIsTaxable(row.isTaxable ?? row.taxable ?? row["Taxable"], type)
            : false,
        facilityId,
        createdBy: createdBy || null,
        status: "Active",
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Upload rejected: ${errors.length} row(s) failed validation. No records were imported.`,
        data: {
          created: 0,
          failed: errors.length,
          errors,
          transactional: true,
        },
      });
    }

    const transaction = await db.sequelize.transaction();
    try {
      for (const record of normalizedRows) {
        await db.allowances.create(record, { transaction });
      }
      await transaction.commit();

      return res.json({
        success: true,
        message: `${normalizedRows.length} record(s) imported successfully`,
        data: {
          created: normalizedRows.length,
          failed: 0,
          errors: [],
          transactional: true,
        },
      });
    } catch (insertErr) {
      await transaction.rollback();
      console.error("Bulk allowance import transaction failed:", insertErr);
      return res.status(500).json({
        success: false,
        message: "Import failed — no records were saved",
        data: {
          created: 0,
          failed: normalizedRows.length,
          errors: [{ row: null, message: insertErr.message }],
          transactional: true,
        },
      });
    }
  } catch (error) {
    console.error("Error in bulkCreateAllowances:", error);
    return res.status(500).json({
      success: false,
      message: "Error processing bulk upload",
      error: error.message,
    });
  }
};

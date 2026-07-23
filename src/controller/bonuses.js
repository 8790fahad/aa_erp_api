const db = require("../models");
const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");

const parseAccountCode = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parenMatch = raw.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) return parenMatch[1].trim();
  return raw;
};

const loadFacilityAccountCodes = async (facilityId) => {
  const categories = await db.AccountCategory.findAll({
    where: { facilityId, isActive: true },
    attributes: ["code"],
  });
  return new Set(categories.map((c) => String(c.code).trim()));
};

const validateAccountCodeForFacility = async (facilityId, accountCode) => {
  const code = parseAccountCode(accountCode);
  if (!code) {
    return "Accounting Ledger is required";
  }
  const accountCodeSet = await loadFacilityAccountCodes(facilityId);
  if (!accountCodeSet.has(code)) {
    return `Invalid Accounting Ledger '${code}' — account not found for this facility`;
  }
  return null;
};

const parseBonusMonthYear = (row) => {
  const monthRaw =
    row.bonusMonth ||
    row["Bonus Month"] ||
    row.month ||
    "";
  const yearRaw =
    row.bonusYear ||
    row["Bonus Year"] ||
    row.year ||
    "";

  let month = String(monthRaw).trim();
  let year = String(yearRaw).trim();

  if (!month && row.bonusDate) {
    const d = new Date(row.bonusDate);
    if (!Number.isNaN(d.getTime())) {
      month = String(d.getMonth() + 1).padStart(2, "0");
      year = String(d.getFullYear());
    }
  }

  if (/^\d{1,2}$/.test(month)) {
    month = month.padStart(2, "0");
  }

  return { month, year };
};

const isCurrentOrFutureBonusPeriod = (month, year) => {
  if (!month || !year) return false;
  if (!/^(0[1-9]|1[0-2])$/.test(String(month)) || !/^\d{4}$/.test(String(year))) {
    return false;
  }
  const bonusPeriod = new Date(Number(year), Number(month) - 1, 1);
  const currentPeriod = new Date();
  currentPeriod.setDate(1);
  currentPeriod.setHours(0, 0, 0, 0);
  return bonusPeriod >= currentPeriod;
};

const validateBonusPeriodFromDate = (bonusDate) => {
  if (!bonusDate) return "Bonus Month and Bonus Year are required";
  const d = new Date(bonusDate);
  if (Number.isNaN(d.getTime())) {
    return "Invalid Bonus Month / Bonus Year";
  }
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  if (!isCurrentOrFutureBonusPeriod(month, year)) {
    return "Bonus Month and Bonus Year must be current or future";
  }
  return null;
};

// Create new bonus
exports.createBonus = async (req, res) => {
  try {
    const {
      employeeId,
      employeeName,
      bonusType,
      amount,
      calculationType,
      reason,
      bonusDate,
      description,
      accountCode,
      isTaxable,
      facilityId,
      createdBy,
    } = req.body;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId is missing in request body"
      });
    }

    // Validate required fields
    if (!employeeId || !bonusType || !amount || !reason || !bonusDate || !accountCode) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        error:
          "employeeId, bonusType, amount, reason, bonusDate, and accountCode are required",
      });
    }

    const accountError = await validateAccountCodeForFacility(facilityId, accountCode);
    if (accountError) {
      return res.status(400).json({
        success: false,
        message: accountError,
      });
    }

    const periodError = validateBonusPeriodFromDate(bonusDate);
    if (periodError) {
      return res.status(400).json({
        success: false,
        message: periodError,
      });
    }

    const normalizedAccountCode = parseAccountCode(accountCode);

    const bonus = await db.bonuses.create({
      id: uuidv4(),
      employeeId,
      facilityId,
      employeeName,
      bonusType,
      amount: parseFloat(amount),
      calculationType,
      reason,
      bonusDate: new Date(bonusDate),
      status: "approved",
      approvedBy: createdBy || null,
      approvedAt: new Date(),
      description,
      accountCode: normalizedAccountCode,
      isTaxable: isTaxable === false || isTaxable === 0 || isTaxable === "0" || String(isTaxable).toLowerCase() === "no"
        ? false
        : true,
      createdBy,
    });

    res.status(201).json({
      success: true,
      message: "Bonus created successfully",
      data: bonus,
    });
  } catch (error) {
    console.error("Error creating bonus:", error);
    res.status(500).json({
      success: false,
      message: "Error creating bonus",
      error: error.message,
    });
  }
};

// Get all bonuses
exports.getAllBonuses = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      employeeId, 
      status, 
      bonusType,
      facilityId 
    } = req.query;
    
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
      whereClause[Op.or] = [
        { employeeName: { [Op.like]: `%${search}%` } },
        { bonusType: { [Op.like]: `%${search}%` } },
        { reason: { [Op.like]: `%${search}%` } },
      ];
    }

    if (employeeId) {
      whereClause.employeeId = employeeId;
    }

    if (status) {
      whereClause.status = status;
    }

    if (bonusType) {
      whereClause.bonusType = bonusType;
    }

    const { count, rows } = await db.bonuses.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.employees,
          as: "employee",
          attributes: ["id", "employeeId", "firstName", "lastName", "designation"],
        },
        {
          model: db.users,
          as: "creator",
          attributes: ["id", "firstname", "lastname", "email"],
        },
        {
          model: db.users,
          as: "approver",
          attributes: ["id", "firstname", "lastname", "email"],
        },
      ],
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
    console.error("Error fetching bonuses:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching bonuses",
      error: error.message,
    });
  }
};

// Get bonus by ID
exports.getBonusById = async (req, res) => {
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

    const bonus = await db.bonuses.findOne({
      where: { id, facilityId },
      include: [
        {
          model: db.employees,
          as: "employee",
          attributes: ["id", "employeeId", "firstName", "lastName", "designation", "departmentId"],
        },
        {
          model: db.users,
          as: "creator",
          attributes: ["id", "firstname", "lastname", "email"],
        },
        {
          model: db.users,
          as: "approver",
          attributes: ["id", "firstname", "lastname", "email"],
        },
        {
          model: db.users,
          as: "updater",
          attributes: ["id", "firstname", "lastname", "email"],
        },
      ],
    });

    if (!bonus) {
      return res.status(404).json({
        success: false,
        message: "Bonus not found",
      });
    }

    res.json({
      success: true,
      data: bonus,
    });
  } catch (error) {
    console.error("Error fetching bonus:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching bonus",
      error: error.message,
    });
  }
};

// Update bonus
exports.updateBonus = async (req, res) => {
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

    const bonus = await db.bonuses.findOne({
      where: { id, facilityId },
    });

    if (!bonus) {
      return res.status(404).json({
        success: false,
        message: "Bonus not found",
      });
    }

    // Handle date conversion if bonusDate is provided
    const updateData = { ...req.body };
    delete updateData.status;
    if (updateData.bonusDate) {
      updateData.bonusDate = new Date(updateData.bonusDate);
    }
    if (updateData.amount) {
      updateData.amount = parseFloat(updateData.amount);
    }

    const effectiveAccountCode =
      updateData.accountCode !== undefined
        ? updateData.accountCode
        : bonus.accountCode;
    const accountError = await validateAccountCodeForFacility(
      facilityId,
      effectiveAccountCode,
    );
    if (accountError) {
      return res.status(400).json({
        success: false,
        message: accountError,
      });
    }
    if (updateData.accountCode !== undefined) {
      updateData.accountCode = parseAccountCode(updateData.accountCode);
    }

    if (updateData.isTaxable !== undefined) {
      const v = updateData.isTaxable;
      updateData.isTaxable = !(
        v === false ||
        v === 0 ||
        v === "0" ||
        String(v).toLowerCase() === "no" ||
        String(v).toLowerCase() === "false"
      );
    }

    if (updateData.bonusDate !== undefined) {
      const periodError = validateBonusPeriodFromDate(updateData.bonusDate);
      if (periodError) {
        return res.status(400).json({
          success: false,
          message: periodError,
        });
      }
    }

    const updatedBonus = await bonus.update({
      ...updateData,
      updatedBy,
    });

    res.json({
      success: true,
      message: "Bonus updated successfully",
      data: updatedBonus,
    });
  } catch (error) {
    console.error("Error updating bonus:", error);
    res.status(500).json({
      success: false,
      message: "Error updating bonus",
      error: error.message,
    });
  }
};

// Delete bonus
exports.deleteBonus = async (req, res) => {
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

    const bonus = await db.bonuses.findOne({
      where: { id, facilityId },
    });

    if (!bonus) {
      return res.status(404).json({
        success: false,
        message: "Bonus not found",
      });
    }

    await bonus.destroy();

    res.json({
      success: true,
      message: "Bonus deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting bonus:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting bonus",
      error: error.message,
    });
  }
};

// Approve bonus
exports.approveBonus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status = "approved", approvedBy } = req.body;
    const { facilityId } = req.query;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }

    const bonus = await db.bonuses.findOne({
      where: { id, facilityId },
    });

    if (!bonus) {
      return res.status(404).json({
        success: false,
        message: "Bonus not found",
      });
    }

    const updatedBonus = await bonus.update({
      status,
      approvedBy,
      approvedAt: new Date(),
    });

    res.json({
      success: true,
      message: "Bonus status updated successfully",
      data: updatedBonus,
    });
  } catch (error) {
    console.error("Error updating bonus status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating bonus status",
      error: error.message,
    });
  }
};

// Get bonus statistics
exports.getBonusStatistics = async (req, res) => {
  try {
    const { facilityId } = req.query;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }

    const stats = await db.bonuses.findAll({
      where: { facilityId },
      attributes: [
        'status',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        [db.sequelize.fn('SUM', db.sequelize.col('amount')), 'totalAmount']
      ],
      group: ['status'],
    });

    const totalBonuses = await db.bonuses.count({
      where: { facilityId },
    });

    const totalAmount = await db.bonuses.sum('amount', {
      where: { facilityId },
    });

    res.json({
      success: true,
      data: {
        totalBonuses,
        totalAmount: totalAmount || 0,
        statusBreakdown: stats,
      },
    });
  } catch (error) {
    console.error("Error fetching bonus statistics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching bonus statistics",
      error: error.message,
    });
  }
};

// Bulk create bonuses from Excel upload (all-or-nothing transaction)
exports.bulkCreateBonuses = async (req, res) => {
  const { bonuses, facilityId, createdBy } = req.body;

  if (!facilityId) {
    return res.status(400).json({ success: false, message: "facilityId is required" });
  }
  if (!Array.isArray(bonuses) || bonuses.length === 0) {
    return res.status(400).json({ success: false, message: "bonuses array is required" });
  }

  const errors = [];
  const normalizedRows = [];
  const validCalculationTypes = ["fixed", "percentage"];

  try {
    const [employees, accountCodeSet] = await Promise.all([
      db.employees.findAll({
        where: { facilityId },
        attributes: ["id", "employeeId", "firstName", "lastName", "status"],
      }),
      loadFacilityAccountCodes(facilityId),
    ]);

    const employeeById = new Map(employees.map((e) => [String(e.id), e]));
    const employeeByCode = new Map(
      employees.map((e) => [String(e.employeeId || "").trim(), e]),
    );

    for (let i = 0; i < bonuses.length; i++) {
      const row = bonuses[i];
      const rowNum = i + 2;

      const employeeKey = String(
        row.employeeId || row["Employee ID"] || "",
      ).trim();
      const bonusType = String(row.bonusType || row["Bonus Type"] || "").trim();
      const calculationType = String(
        row.calculationType || row["Calculation Type"] || "fixed",
      )
        .trim()
        .toLowerCase();
      const amountRaw = row.amount ?? row["Value"] ?? row["Amount"];
      const reason = String(row.reason || row["Reason"] || "").trim();
      const description = String(row.description || row["Description"] || "").trim();
      const accountCode = parseAccountCode(
        row.accountCode || row["Accounting Ledger"] || row["Account Code"],
      );
      const { month, year } = parseBonusMonthYear(row);

      if (!employeeKey) {
        errors.push({ row: rowNum, message: "Employee ID is required" });
        continue;
      }
      if (!bonusType) {
        errors.push({ row: rowNum, message: "Bonus Type is required" });
        continue;
      }
      if (amountRaw === undefined || amountRaw === null || String(amountRaw).trim() === "") {
        errors.push({ row: rowNum, message: "Value is required" });
        continue;
      }
      if (!reason) {
        errors.push({ row: rowNum, message: "Reason is required" });
        continue;
      }
      if (!month || !year) {
        errors.push({
          row: rowNum,
          message: "Bonus Month and Bonus Year are required",
        });
        continue;
      }
      if (!/^(0[1-9]|1[0-2])$/.test(month)) {
        errors.push({
          row: rowNum,
          message: `Invalid Bonus Month '${month}' — use 01–12`,
        });
        continue;
      }
      if (!/^\d{4}$/.test(year)) {
        errors.push({
          row: rowNum,
          message: `Invalid Bonus Year '${year}' — use YYYY`,
        });
        continue;
      }
      const bonusPeriod = new Date(Number(year), Number(month) - 1, 1);
      const currentPeriod = new Date();
      currentPeriod.setDate(1);
      currentPeriod.setHours(0, 0, 0, 0);
      if (bonusPeriod < currentPeriod) {
        errors.push({
          row: rowNum,
          message: "Bonus Month and Bonus Year must be current or future",
        });
        continue;
      }
      if (!validCalculationTypes.includes(calculationType)) {
        errors.push({
          row: rowNum,
          message: `Invalid Calculation Type '${calculationType}' — use fixed or percentage`,
        });
        continue;
      }

      const amount = parseFloat(amountRaw);
      if (Number.isNaN(amount) || amount < 0) {
        errors.push({ row: rowNum, message: "Value must be a valid number >= 0" });
        continue;
      }
      if (calculationType === "percentage" && amount > 100) {
        errors.push({
          row: rowNum,
          message: "Percentage value cannot exceed 100",
        });
        continue;
      }

      const employee =
        employeeById.get(employeeKey) || employeeByCode.get(employeeKey);
      if (!employee) {
        errors.push({
          row: rowNum,
          message: `Invalid Employee ID '${employeeKey}' — employee not found for this facility`,
        });
        continue;
      }

      if (!accountCode) {
        errors.push({
          row: rowNum,
          message: "Accounting Ledger is required",
        });
        continue;
      }
      if (!accountCodeSet.has(accountCode)) {
        errors.push({
          row: rowNum,
          message: `Invalid Accounting Ledger '${accountCode}' — account not found for this facility`,
        });
        continue;
      }

      normalizedRows.push({
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        bonusType,
        amount,
        calculationType,
        reason,
        bonusDate: `${year}-${month}-01`,
        description: description || null,
        accountCode: accountCode || null,
        isTaxable: (() => {
          const raw = row.isTaxable ?? row.taxable ?? row["Taxable"];
          if (raw === undefined || raw === null || String(raw).trim() === "") return true;
          const v = String(raw).trim().toLowerCase();
          if (["no", "n", "false", "0", "non-taxable", "not taxable", "non taxable"].includes(v)) {
            return false;
          }
          return true;
        })(),
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
      const created = [];
      for (const row of normalizedRows) {
        const bonus = await db.bonuses.create(
          {
            id: uuidv4(),
            employeeId: row.employeeId,
            facilityId,
            employeeName: row.employeeName,
            bonusType: row.bonusType,
            amount: row.amount,
            calculationType: row.calculationType,
            reason: row.reason,
            bonusDate: new Date(row.bonusDate),
            status: "approved",
            approvedBy: createdBy || null,
            approvedAt: new Date(),
            description: row.description,
            accountCode: row.accountCode,
            isTaxable: row.isTaxable !== false,
            createdBy: createdBy || null,
          },
          { transaction },
        );
        created.push(bonus);
      }

      await transaction.commit();

      return res.json({
        success: true,
        message: `Bulk import complete: ${created.length} created`,
        data: {
          created: created.length,
          failed: 0,
          errors: [],
          transactional: true,
        },
      });
    } catch (err) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: err.message || "Bulk import failed. No records were imported.",
        data: {
          created: 0,
          failed: normalizedRows.length,
          errors: [{ row: null, message: err.message }],
          transactional: true,
        },
      });
    }
  } catch (error) {
    console.error("Error bulk creating bonuses:", error);
    return res.status(500).json({
      success: false,
      message: "Error bulk creating bonuses",
      error: error.message,
    });
  }
};
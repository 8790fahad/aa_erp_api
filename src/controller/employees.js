const db = require("../models");
const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");
const {
  syncEmployeePayeProfileFromStructure,
} = require("./payeSettings");

// Generate employee ID
const generateEmployeeId = async (facilityId) => {
  // Find the highest numeric id for EMP-XXXX in this facility
  const lastEmployee = await db.employees.findOne({
    where: {
      facilityId,
      employeeId: { [Op.like]: "EMP-%" },
    },
    order: [["employeeId", "DESC"]],
  });

  let nextNumber = 1;
  if (lastEmployee && lastEmployee.employeeId) {
    const parts = lastEmployee.employeeId.split("-");
    if (parts.length === 2) {
      const lastNumber = parseInt(parts[1], 10);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `EMP-${String(nextNumber).padStart(4, "0")}`;
};

// Get all employees
exports.getAllEmployees = async (req, res) => {
  try {
    const { facilityId, status = "Active" } = req.query;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId query parameter is missing"
      });
    }

    const employees = await db.employees.findAll({
      where: { 
        facilityId,
        status: status === "All" ? { [Op.ne]: null } : status
      },
      attributes: [
        "id",
        "employeeId", 
        "firstName",
        "lastName",
        "email",
        "phone",
        "designation",
        "departmentId",
        "hireDate",
        "contractType",
        "salaryStructureId",
        "status",
        "salaryStatus",
        "salaryStatusReason",
        "salaryStatusDate",
        "createdAt"
      ],
      include: [
        {
          model: db.Department,
          as: "department",
          attributes: ["id", "departmentName", "departmentCode"],
          required: false,
        },
      ],
      order: [["firstName", "ASC"]],
    });

    res.json({
      success: true,
      data: { employees },
    });
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employees",
      error: error.message,
    });
  }
};

// Create new employee
exports.createEmployee = async (req, res) => {
  try {
    const {
      userId,
      employeeId: requestedEmployeeId,
      firstName,
      lastName,
      gender,
      dateOfBirth,
      contactInfo,
      address,
      nationalId,
      bankAccount,
      bankName,
      bankCode,
      accountName,
      accountType,
      photoUrl,
      departmentId,
      designation,
      hireDate,
      contractType,
      salaryStructureId,
      emergencyContact,
      emergencyPhone,
      nextOfKin,
      nextOfKinPhone,
      appliesRent,
      appliesNHF,
      appliesNHIS,
      appliesPension,
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

    // Use custom employee ID when provided, otherwise auto-generate
    const customEmployeeId = String(requestedEmployeeId || "").trim();
    let employeeId;
    if (customEmployeeId) {
      const existing = await db.employees.findOne({
        where: { facilityId, employeeId: customEmployeeId },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Employee ID "${customEmployeeId}" is already in use`,
        });
      }
      employeeId = customEmployeeId;
    } else {
      employeeId = await generateEmployeeId(facilityId);
    }

    const employee = await db.employees.create({
      id: uuidv4(),
      employeeId,
      userId,
      facilityId,
      firstName,
      lastName,
      gender,
      dateOfBirth,
      contactInfo,
      address,
      nationalId,
      bankAccount,
      bankName,
      bankCode,
      accountName,
      accountType,
      photoUrl,
      departmentId,
      designation,
      hireDate,
      contractType,
      salaryStructureId,
      emergencyContact,
      emergencyPhone,
      nextOfKin,
      nextOfKinPhone,
      createdBy,
      status: "Active",
    });

    // Initialize leave balances for the year
    const currentYear = new Date().getFullYear();
    const leaveTypes = [
      "Annual",
      "Sick",
      "Maternity",
      "Paternity",
      "Emergency",
    ];

    for (const leaveType of leaveTypes) {
      let totalDays = 0;
      if (leaveType === "Annual") totalDays = 21; 
      else if (leaveType === "Sick") totalDays = 12; 
      else if (leaveType === "Maternity") totalDays = 90; // 90 days maternity
      else if (leaveType === "Paternity") totalDays = 14; // 14 days paternity
      else if (leaveType === "Emergency") totalDays = 5; // 5 days emergency

      await db.leave_balances.create({
        id: uuidv4(),
        employeeId: employee.id,
        facilityId,
        year: currentYear,
        leaveType,
        totalDays,
        usedDays: 0,
        remainingDays: totalDays,
        accruedDays: totalDays,
        createdBy,
      });
    }

    // Link salary structure → PAYE profile so tax setup picks up basic pay + relief flags
    if (salaryStructureId) {
      try {
        await syncEmployeePayeProfileFromStructure(employee, {
          payeFlags: { appliesRent, appliesNHF, appliesNHIS, appliesPension },
        });
      } catch (payeErr) {
        console.error("PAYE profile sync on create:", payeErr);
      }
    }

    res.status(201).json({
      success: true,
      message: "Employee created successfully",
      data: employee,
    });
  } catch (error) {
    console.error("Error creating employee:", error);
    res.status(500).json({
      success: false,
      message: "Error creating employee",
      error: error.message,
    });
  }
};

// Get all employees
exports.getAllEmployees = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, departmentId, status, facilityId } = req.query;
    
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
        { firstName: { [Op.like]: `%${search}%` } },
        { lastName: { [Op.like]: `%${search}%` } },
        { employeeId: { [Op.like]: `%${search}%` } },
        { designation: { [Op.like]: `%${search}%` } },
      ];
    }

    if (departmentId) {
      whereClause.departmentId = departmentId;
    }

    if (status) {
      whereClause.status = status;
    }

    const { count, rows } = await db.employees.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.users,
          as: "user",
          attributes: ["id", "email", "phone", "image"],
        },
        {
          model: db.Department,
          as: "department",
          attributes: ["id", "departmentName", "departmentCode"],
        },
        {
          model: db.salary_structures,
          as: "salaryStructure",
          attributes: ["id", "structureName", "basicSalary", "allowances", "deductions", "payeRate", "pensionRate"],
        },
        {
          model: db.employee_paye_profiles,
          as: "payeProfile",
          attributes: [
            "appliesRent",
            "appliesNHF",
            "appliesNHIS",
            "appliesPension",
          ],
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
        employees: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employees",
      error: error.message,
    });
  }
};

// Get employee by ID
exports.getEmployeeById = async (req, res) => {
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

    const employee = await db.employees.findOne({
      where: { id, facilityId },
      include: [
        {
          model: db.users,
          as: "user",
          attributes: ["id", "email", "phone", "image", "role"],
        },
        {
          model: db.Department,
          as: "department",
          attributes: ["id", "departmentName", "departmentCode", "description"],
        },
        {
          model: db.salary_structures,
          as: "salaryStructure",
          attributes: [
            "id",
            "structureName",
            "basicSalary",
            "allowances",
            "deductions",
            "payeRate",
            "pensionRate",
          ],
        },
        {
          model: db.leave_balances,
          as: "leaveBalances",
          where: { year: new Date().getFullYear() },
          required: false,
        },
        {
          model: db.employee_paye_profiles,
          as: "payeProfile",
          required: false,
        },
      ],
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    // Fetch extra components (role-based or structure-based from master table)
    const masterAllowances = await db.allowances.findAll({
      where: {
        facilityId,
        status: "Active",
        [Op.or]: [
          { salaryStructureId: employee.salaryStructureId },
          { roleName: employee.designation, isRoleBased: true }
        ]
      }
    });

    // Merge everything into a plain object to avoid Sequelize issues when adding virtual fields
    const employeeData = employee.get({ plain: true });
    employeeData.masterAllowances = masterAllowances;

    res.json({
      success: true,
      data: employeeData,
    });
  } catch (error) {
    console.error("Error fetching employee:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee",
      error: error.message,
    });
  }
};

// Update employee
exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      facilityId,
      updatedBy,
      employeeId: requestedEmployeeId,
      appliesRent,
      appliesNHF,
      appliesNHIS,
      appliesPension,
      ...rest
    } = req.body;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId is missing in request body"
      });
    }

    const employee = await db.employees.findOne({
      where: { id, facilityId },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const updatePayload = { ...rest, updatedBy };

    const customEmployeeId = String(requestedEmployeeId || "").trim();
    if (customEmployeeId && customEmployeeId !== employee.employeeId) {
      const existing = await db.employees.findOne({
        where: {
          facilityId,
          employeeId: customEmployeeId,
          id: { [Op.ne]: id },
        },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Employee ID "${customEmployeeId}" is already in use`,
        });
      }
      updatePayload.employeeId = customEmployeeId;
    }

    const updatedEmployee = await employee.update(updatePayload);

    if (updatePayload.salaryStructureId || updatedEmployee.salaryStructureId) {
      try {
        await syncEmployeePayeProfileFromStructure(updatedEmployee, {
          force: Boolean(updatePayload.salaryStructureId),
          payeFlags: { appliesRent, appliesNHF, appliesNHIS, appliesPension },
        });
      } catch (payeErr) {
        console.error("PAYE profile sync on update:", payeErr);
      }
    }

    res.json({
      success: true,
      message: "Employee updated successfully",
      data: updatedEmployee,
    });
  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(500).json({
      success: false,
      message: "Error updating employee",
      error: error.message,
    });
  }
};

// Deactivate employee
exports.deactivateEmployee = async (req, res) => {
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

    const employee = await db.employees.findOne({
      where: { id, facilityId },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    await employee.update({
      status: "Inactive",
      updatedBy,
    });

    res.json({
      success: true,
      message: "Employee deactivated successfully",
    });
  } catch (error) {
    console.error("Error deactivating employee:", error);
    res.status(500).json({
      success: false,
      message: "Error deactivating employee",
      error: error.message,
    });
  }
};

// Get employee promotion history
exports.getPromotionHistory = async (req, res) => {
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

    // Verify employee exists
    const employee = await db.employees.findOne({
      where: { id, facilityId },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    // Get promotion history
    const promotions = await db.promotion_history.findAll({
      where: { employeeId: id, facilityId },
      include: [
        {
          model: db.users,
          as: "approver",
          attributes: ["id", "firstname", "lastname", "email"],
        },
        {
          model: db.Department,
          as: "previousDepartment",
          attributes: ["id", "departmentName", "departmentCode"],
        },
        {
          model: db.Department,
          as: "newDepartment",
          attributes: ["id", "departmentName", "departmentCode"],
        },
        {
          model: db.salary_structures,
          as: "previousSalaryStructure",
          attributes: ["id", "structureName", "basicSalary"],
        },
        {
          model: db.salary_structures,
          as: "newSalaryStructure",
          attributes: ["id", "structureName", "basicSalary"],
        },
      ],
      order: [["effectiveDate", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        employeeId: employee.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        promotions,
      },
    });
  } catch (error) {
    console.error("Error fetching promotion history:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching promotion history",
      error: error.message,
    });
  }
};

// Update employee promotion
exports.updatePromotion = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      newRole, 
      newSalary, 
      effectiveDate, 
      reason, 
      newDepartmentId,
      status = "Approved",
      facilityId,
      updatedBy
    } = req.body;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
        error: "facilityId is missing in request body"
      });
    }

    const employee = await db.employees.findOne({
      where: { id, facilityId },
      include: [
        {
          model: db.Department,
          as: "department",
          attributes: ["id", "departmentName"],
        },
        {
          model: db.salary_structures,
          as: "salaryStructure",
          attributes: ["id", "structureName", "basicSalary"],
        },
      ],
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    // Store previous values for history
    const previousDesignation = employee.designation;
    const previousDepartmentId = employee.departmentId;
    const previousSalaryStructureId = employee.salaryStructureId;
    const previousSalary = employee.salaryStructure?.basicSalary || 0;

    // Start transaction
    const transaction = await db.sequelize.transaction();

    try {
      // Create promotion history record
      const promotionRecord = await db.promotion_history.create({
        id: uuidv4(),
        employeeId: employee.id,
        facilityId,
        previousDesignation,
        newDesignation: newRole,
        previousDepartmentId,
        newDepartmentId: newDepartmentId || employee.departmentId,
        previousSalaryStructureId,
        newSalaryStructureId: null, // Will be set after finding/creating salary structure
        previousSalary,
        newSalary: newSalary || previousSalary,
        effectiveDate: new Date(effectiveDate),
        reason,
        approvedBy: updatedBy,
        approvedAt: new Date(),
        status,
        createdBy: updatedBy,
      }, { transaction });

      // Update employee designation
      const updateData = {
        designation: newRole,
        updatedBy,
      };

      // Update department if provided
      if (newDepartmentId) {
        updateData.departmentId = newDepartmentId;
      }

      // Update salary structure if provided
      if (newSalary) {
        // Find or create salary structure with new salary
        let salaryStructure = await db.salary_structures.findOne({
          where: {
            facilityId,
            basicSalary: newSalary,
          },
        });

        if (!salaryStructure) {
          // Create new salary structure
          salaryStructure = await db.salary_structures.create({
            id: uuidv4(),
            facilityId,
            structureName: `${newRole} Salary Structure`,
            basicSalary: newSalary,
            allowances: {},
            deductions: {},
            createdBy: updatedBy,
          }, { transaction });
        }

        updateData.salaryStructureId = salaryStructure.id;
        
        // Update promotion record with new salary structure
        await promotionRecord.update({
          newSalaryStructureId: salaryStructure.id,
        }, { transaction });
      }

      // Update employee
      await employee.update(updateData, { transaction });

      // Commit transaction
      await transaction.commit();

      res.json({
        success: true,
        message: "Employee promotion updated successfully",
        data: {
          employeeId: employee.employeeId,
          promotionId: promotionRecord.id,
          previousDesignation,
          newDesignation: newRole,
          previousSalary,
          newSalary: newSalary || previousSalary,
          effectiveDate,
          status,
        },
      });
    } catch (transactionError) {
      // Rollback transaction
      await transaction.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("Error updating promotion:", error);
    res.status(500).json({
      success: false,
      message: "Error updating promotion",
      error: error.message,
    });
  }
};

// Get HR users
exports.getHRUsers = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const users = await db.users.findAll({
      where: {
        facilityId: facilityId,
        status: "Active",
      },
      attributes: [
        "id",
        "firstname",
        "lastname",
        "email",
        "phone",
        "address",
        "departmentId",
        "role",
        "status",
        "image",
      ],
      order: [["firstname", "ASC"]],
    });

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: error.message,
    });
  }
};

// Get HR departments
exports.getHRDepartments = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const departments = await db.Department.findAll({
      where: {
        facilityId: facilityId,
        status: "active",
      },
      attributes: [
        "id",
        "departmentName",
        "departmentCode",
        "description",
        "status",
        "headOfDepartment",
      ],
      order: [["departmentName", "ASC"]],
    });

    res.json({
      success: true,
      data: departments,
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching departments",
      error: error.message,
    });
  }
};

// Update salary status (Stop/Start Salary)
exports.updateSalaryStatus = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { salaryStatus, reason, performedBy, facilityId } = req.body;

    if (!salaryStatus || !reason || !performedBy || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: salaryStatus, reason, performedBy, facilityId",
      });
    }

    if (!["Active", "Stopped"].includes(salaryStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid salaryStatus. Must be 'Active' or 'Stopped'",
      });
    }

    const employee = await db.employees.findOne({
      where: { id, facilityId },
      transaction
    });

    if (!employee) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const currentDate = new Date();

    // Update employee status
    await employee.update({
      salaryStatus,
      salaryStatusReason: reason,
      salaryStatusDate: currentDate,
      updatedBy: performedBy 
    }, { transaction });

    // Ensure table salary_status_history exists and insert history record
    if (db.salary_status_history) {
      await db.salary_status_history.create({
        id: uuidv4(),
        employeeId: id,
        facilityId,
        status: salaryStatus,
        reason,
        date: currentDate,
        performedBy
      }, { transaction });
    } else {
      console.warn("salary_status_history model not found, skipping history logging");
    }

    await transaction.commit();

    res.json({
      success: true,
      message: `Salary successfully marked as ${salaryStatus}`,
      data: {
        salaryStatus,
        salaryStatusReason: reason,
        salaryStatusDate: currentDate
      }
    });
  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }
    console.error("Error updating salary status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating salary status",
      error: error.message,
    });
  }
};

// Bulk create employees from Excel upload
// Bulk create employees from Excel upload (all-or-nothing transaction)
exports.bulkCreateEmployees = async (req, res) => {
  const { employees, facilityId, createdBy } = req.body;

  if (!facilityId) {
    return res.status(400).json({ success: false, message: "facilityId is required" });
  }
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ success: false, message: "employees array is required" });
  }

  const errors = [];
  const normalizedRows = [];
  const validGenders = ["Male", "Female", "Other"];
  const validContracts = [
    "Permanent",
    "Full-time",
    "Contract",
    "Intern",
    "Part-time",
  ];

  try {
    const [roles, departments, structures, banks] = await Promise.all([
      db.Role
        ? db.Role.findAll({
            where: { facilityId },
            attributes: ["id", "name", "status"],
          })
        : [],
      db.Department
        ? db.Department.findAll({
            where: { facilityId },
            attributes: ["id", "departmentName", "status"],
          })
        : [],
      db.salary_structures
        ? db.salary_structures.findAll({
            where: { facilityId },
            attributes: ["id", "structureName", "status"],
          })
        : [],
      db.BankList
        ? db.BankList.findAll({
            where: { facilityId },
            attributes: ["bank_code", "bank_name"],
          })
        : [],
    ]);

    const roleById = new Map(roles.map((r) => [String(r.id), r]));
    const roleByName = new Map(
      roles.map((r) => [String(r.name || "").trim().toLowerCase(), r]),
    );
    const deptById = new Map(departments.map((d) => [String(d.id), d]));
    const structureById = new Map(structures.map((s) => [String(s.id), s]));
    const bankByCode = new Map(
      banks.map((b) => [String(b.bank_code).trim(), b]),
    );

    for (let i = 0; i < employees.length; i++) {
      const row = employees[i];
      const rowNum = i + 2;

      const firstName = String(row.firstName || "").trim();
      const lastName = String(row.lastName || "").trim();
      const userId = String(row.userId || "").trim();
      const contactInfo = String(row.contactInfo || "").trim();
      const dateOfBirth = String(row.dateOfBirth || "").trim();
      const hireDate = String(row.hireDate || "").trim();
      const departmentId = String(row.departmentId || "").trim();
      const roleIdRaw = String(row.roleId || "").trim();
      const designationRaw = String(row.designation || "").trim();
      const salaryStructureId = String(row.salaryStructureId || "").trim();
      const bankCode = String(row.bankCode || "").trim();
      const bankAccount = String(row.bankAccount || "").trim();
      const accountName = String(row.accountName || "").trim();
      const gender = String(row.gender || "Male").trim();
      const contractType = String(row.contractType || "Permanent").trim();
      const customEmployeeId = String(row.employeeId || "").trim();

      if (!firstName || !lastName) {
        errors.push({ row: rowNum, message: "First Name and Last Name are required" });
        continue;
      }
      if (!contactInfo) {
        errors.push({ row: rowNum, message: "Contact Info is required" });
        continue;
      }
      if (!dateOfBirth) {
        errors.push({ row: rowNum, message: "Date of Birth is required" });
        continue;
      }
      if (!hireDate) {
        errors.push({ row: rowNum, message: "Hire Date is required" });
        continue;
      }
      if (!validGenders.includes(gender)) {
        errors.push({
          row: rowNum,
          message: `Invalid Gender '${gender}' — use Male, Female, or Other`,
        });
        continue;
      }
      if (!validContracts.includes(contractType)) {
        errors.push({
          row: rowNum,
          message: `Invalid Contract Type '${contractType}' — use Permanent, Full-time, Contract, Intern, or Part-time`,
        });
        continue;
      }

      const department = deptById.get(departmentId);
      if (!department) {
        errors.push({
          row: rowNum,
          message: `Invalid Department ID '${departmentId || ""}' — department not found for this facility`,
        });
        continue;
      }

      let role =
        (roleIdRaw && roleById.get(roleIdRaw)) ||
        (roleIdRaw && roleById.get(String(Number(roleIdRaw)))) ||
        (designationRaw && roleByName.get(designationRaw.toLowerCase())) ||
        null;
      if (!role) {
        errors.push({
          row: rowNum,
          message: `Invalid Role ID '${roleIdRaw || designationRaw || ""}' — role not found for this facility`,
        });
        continue;
      }

      if (!salaryStructureId) {
        errors.push({ row: rowNum, message: "Salary Structure ID is required" });
        continue;
      }
      const structure = structureById.get(salaryStructureId);
      if (!structure) {
        errors.push({
          row: rowNum,
          message: `Invalid Salary Structure ID '${salaryStructureId}' — not found for this facility`,
        });
        continue;
      }
      if (structure.status && structure.status !== "Active") {
        errors.push({
          row: rowNum,
          message: `Salary Structure '${salaryStructureId}' is not Active`,
        });
        continue;
      }

      if (!bankCode) {
        errors.push({ row: rowNum, message: "Bank Code is required" });
        continue;
      }
      const bank = bankByCode.get(bankCode);
      if (!bank) {
        errors.push({
          row: rowNum,
          message: `Invalid Bank Code '${bankCode}' — bank not found for this facility`,
        });
        continue;
      }
      if (!bankAccount) {
        errors.push({ row: rowNum, message: "Account Number is required" });
        continue;
      }
      if (!accountName) {
        errors.push({ row: rowNum, message: "Account Name is required" });
        continue;
      }

      if (customEmployeeId && !/^[A-Za-z0-9._-]+$/.test(customEmployeeId)) {
        errors.push({
          row: rowNum,
          message: `Invalid Employee ID '${customEmployeeId}'`,
        });
        continue;
      }

      normalizedRows.push({
        userId,
        employeeId: customEmployeeId || null,
        firstName,
        lastName,
        gender,
        dateOfBirth,
        contactInfo,
        address: String(row.address || "").trim() || null,
        nationalId: String(row.nationalId || "").trim() || null,
        bankAccount,
        bankName: bank.bank_name,
        bankCode,
        accountName,
        accountType: String(row.accountType || "").trim() || null,
        departmentId: Number(department.id),
        designation: role.name,
        hireDate,
        contractType,
        salaryStructureId: structure.id,
        emergencyContact: String(row.emergencyContact || "").trim() || null,
        emergencyPhone: String(row.emergencyPhone || "").trim() || null,
        nextOfKin: String(row.nextOfKin || "").trim() || null,
        nextOfKinPhone: String(row.nextOfKinPhone || "").trim() || null,
        appliesRent: row.appliesRent,
        appliesNHF: row.appliesNHF,
        appliesNHIS: row.appliesNHIS,
        appliesPension: row.appliesPension,
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
      const usedEmployeeIds = new Set();
      const createdEmployees = [];
      const payeFlagsByEmployeeId = new Map();

      for (let i = 0; i < normalizedRows.length; i++) {
        const row = normalizedRows[i];
        const rowNum = i + 2;

        let employeeId = row.employeeId;
        if (employeeId) {
          if (usedEmployeeIds.has(employeeId)) {
            throw Object.assign(new Error(`Duplicate Employee ID '${employeeId}' in upload`), {
              row: rowNum,
            });
          }
          const existing = await db.employees.findOne({
            where: { facilityId, employeeId },
            transaction,
          });
          if (existing) {
            throw Object.assign(
              new Error(`Employee ID "${employeeId}" is already in use`),
              { row: rowNum },
            );
          }
        } else {
          employeeId = await generateEmployeeId(facilityId);
          while (usedEmployeeIds.has(employeeId)) {
            const parts = employeeId.split("-");
            const n = parseInt(parts[1], 10) + 1;
            employeeId = `EMP-${String(n).padStart(4, "0")}`;
          }
        }
        usedEmployeeIds.add(employeeId);

        const employee = await db.employees.create(
          {
            id: uuidv4(),
            employeeId,
            facilityId,
            userId: row.userId || createdBy || uuidv4(),
            firstName: row.firstName,
            lastName: row.lastName,
            gender: row.gender,
            dateOfBirth: row.dateOfBirth,
            contactInfo: row.contactInfo,
            address: row.address,
            nationalId: row.nationalId,
            bankAccount: row.bankAccount,
            bankName: row.bankName,
            bankCode: row.bankCode,
            accountName: row.accountName,
            accountType: row.accountType,
            departmentId: row.departmentId,
            designation: row.designation,
            hireDate: row.hireDate,
            contractType: row.contractType,
            salaryStructureId: row.salaryStructureId,
            emergencyContact: row.emergencyContact,
            emergencyPhone: row.emergencyPhone,
            nextOfKin: row.nextOfKin,
            nextOfKinPhone: row.nextOfKinPhone,
            createdBy: createdBy || null,
            status: "Active",
          },
          { transaction },
        );
        createdEmployees.push(employee);
        payeFlagsByEmployeeId.set(employee.id, {
          appliesRent: row.appliesRent,
          appliesNHF: row.appliesNHF,
          appliesNHIS: row.appliesNHIS,
          appliesPension: row.appliesPension,
        });
      }

      const currentYear = new Date().getFullYear();
      const leaveTypes = [
        { leaveType: "Annual", totalDays: 21 },
        { leaveType: "Sick", totalDays: 12 },
        { leaveType: "Maternity", totalDays: 90 },
        { leaveType: "Paternity", totalDays: 14 },
        { leaveType: "Emergency", totalDays: 5 },
      ];

      for (const employee of createdEmployees) {
        for (const lt of leaveTypes) {
          await db.leave_balances.create(
            {
              id: uuidv4(),
              employeeId: employee.id,
              facilityId,
              year: currentYear,
              leaveType: lt.leaveType,
              totalDays: lt.totalDays,
              usedDays: 0,
              remainingDays: lt.totalDays,
              accruedDays: lt.totalDays,
              createdBy: createdBy || null,
            },
            { transaction },
          );
        }
      }

      await transaction.commit();

      for (const employee of createdEmployees) {
        try {
          await syncEmployeePayeProfileFromStructure(employee, {
            payeFlags: payeFlagsByEmployeeId.get(employee.id),
          });
        } catch (payeErr) {
          console.error("PAYE profile sync on bulk create:", payeErr);
        }
      }

      return res.json({
        success: true,
        message: `Bulk import complete: ${createdEmployees.length} created`,
        data: {
          created: createdEmployees.length,
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
          failed: 1,
          errors: [{ row: err.row || null, message: err.message }],
          transactional: true,
        },
      });
    }
  } catch (error) {
    console.error("Error bulk creating employees:", error);
    return res.status(500).json({
      success: false,
      message: "Error bulk creating employees",
      error: error.message,
    });
  }
};

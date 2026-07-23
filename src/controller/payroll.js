const db = require("../models");
const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");
const payrollAccounting = require("./payrollAccounting");
const { computePAYE } = require("../utils/paye2026");
const payeSettingsController = require("./payeSettings");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Count Mon–Fri working days in a given month/year.
 * Used as the denominator for proration and daily-rate calculations.
 */
function countWorkingDaysInMonth(year, month) {
  const y = parseInt(year);
  const m = parseInt(month) - 1; // 0-indexed
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, m, d).getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// ─── runPayroll ───────────────────────────────────────────────────────────────
exports.runPayroll = async (req, res) => {
  try {
    const { month, year, facilityId, userId } = req.body;
    const createdBy = userId;

    if (!month || !year) {
      return res.status(400).json({ success: false, message: "Month and year are required" });
    }
    if (!facilityId) {
      return res.status(400).json({ success: false, message: "Facility ID not found in user profile" });
    }

    // Check if payroll already exists for this month and is not in Draft status
    const existingBatch = await db.payroll.findOne({
      where: { 
        facilityId, 
        month: parseInt(month), 
        year: parseInt(year),
        status: { [Op.ne]: "Draft" }
      },
    });

    if (existingBatch) {
      return res.status(400).json({ 
        success: false, 
        message: `Payroll for ${month}/${year} has already been ${existingBatch.status.toLowerCase()}. You cannot re-generate it unless you stop individual payments in the ledger.` 
      });
    }

    // Total Mon-Fri working days in the month (for proration & daily rate)
    const totalWorkingDaysInMonth = countWorkingDaysInMonth(year, month);

    // Get targeted employees
    const employeeWhere = { 
      facilityId, 
      status: "Active",
      salaryStatus: { [Op.ne]: "Stopped" } // Exclude employees with stopped salaries
    };
    // If no employeeIds provided, backend defaults to ALL active staff (excluding stopped salaries)
    if (req.body.employeeIds && Array.isArray(req.body.employeeIds) && req.body.employeeIds.length > 0) {
      employeeWhere.id = { [Op.in]: req.body.employeeIds };
    }

    const employees = await db.employees.findAll({
      where: employeeWhere,
      include: [{ model: db.salary_structures, as: "salaryStructure" }],
    });

    const assessmentYear = parseInt(year, 10);
    const payeSettingsRecord = await payeSettingsController.getPayeSettingsForPayroll(
      facilityId,
      assessmentYear,
      createdBy
    );
    const payeSettings = payeSettingsController.settingsToPlain(payeSettingsRecord);
    const payeAutoCalculation = await payeSettingsController.getBusinessAutoCalculation(facilityId);
    const payeProfilesList = await db.employee_paye_profiles.findAll({ where: { facilityId } });
    const payeProfileMap = Object.fromEntries(
      payeProfilesList.map((p) => [p.employeeId, payeSettingsController.profileToPlain(p)])
    );

    const payrollResults = [];

    for (const employee of employees) {
      // ── Attendance for this month ──────────────────────────────────────
      const attendance = await db.attendance.findAll({
        where: {
          employeeId: employee.id,
          facilityId,
          date: {
            [Op.and]: [
              { [Op.gte]: new Date(year, month - 1, 1) },
              { [Op.lt]:  new Date(year, month,     1) },
            ],
          },
        },
      });

      const presentDays   = attendance.filter(a => a.status === "Present").length;
      const overtimeHours = parseFloat(
        attendance.reduce((t, a) => t + (parseFloat(a.overtimeHours) || 0), 0).toFixed(2)
      );
      // Total actual hours worked (attendance record or assume 8h per present day)
      const totalHoursWorked = attendance.reduce((t, a) => {
        if (a.hoursWorked) return t + parseFloat(a.hoursWorked);
        return t + (a.status === "Present" ? 8 : 0);
      }, 0);

      // ── Salary Structure ───────────────────────────────────────────────
      const salaryStructure = employee.salaryStructure;
      if (!salaryStructure) {
        console.warn(`[Payroll] No salary structure for employee ${employee.employeeId} — skipped`);
        continue;
      }

      const paymentType       = salaryStructure.paymentType || "Monthly";
      const baseRate          = parseFloat(salaryStructure.basicSalary);
      const workingDays       = totalWorkingDaysInMonth;

      let basicSalary;
      let paymentNote;

      if (paymentType === "Daily") {
        // Daily rate × actual days present
        basicSalary = baseRate * presentDays;
        paymentNote = `Daily rate NGN ${baseRate.toFixed(2)} x ${presentDays} days present`;

      } else if (paymentType === "Hourly") {
        // Hourly rate × total hours clocked (from attendance)
        basicSalary = baseRate * totalHoursWorked;
        paymentNote = `Hourly rate NGN ${baseRate.toFixed(2)} x ${totalHoursWorked.toFixed(2)} hrs`;

      } else {
        // Monthly — full salary; prorate if employee was absent
        // Option A: full salary regardless of attendance (comment out to switch)
        basicSalary = baseRate;
        paymentNote = `Monthly salary`;

        // Option B (prorated): uncomment to enable
        // basicSalary = (baseRate / workingDays) * presentDays;
        // paymentNote = `Monthly prorated: ₦${baseRate} / ${workingDays} days × ${presentDays} present`;
      }

      // ── Allowances & Deductions Breakdown ─────────────────────────────
      const allowancesBreakdown = {};
      const deductionsBreakdown = {};
      const bonusBreakdown      = {};

      // 1. Embedded components from salary structure JSON fields
      const structAllowances = normalizeComponentMap(salaryStructure.allowances);
      const structDeductions = normalizeComponentMap(salaryStructure.deductions);

      let totalTaxableAllowances = 0;

      for (const [name, val] of Object.entries(structAllowances)) {
        const amount = resolveComponentAmount(val, basicSalary);
        if (!Number.isFinite(amount) || amount === 0) continue;
        allowancesBreakdown[name] = (allowancesBreakdown[name] || 0) + amount;
        totalTaxableAllowances += amount;
      }
      for (const [name, val] of Object.entries(structDeductions)) {
        const amount = resolveComponentAmount(val, basicSalary);
        if (!Number.isFinite(amount) || amount === 0) continue;
        deductionsBreakdown[name] = (deductionsBreakdown[name] || 0) + amount;
      }

      // 2. Master allowances table — role-based + structure-based + accountCodes
      const masterComponents = await db.allowances.findAll({
        where: {
          facilityId,
          status: "Active",
          [Op.or]: [
            { salaryStructureId: salaryStructure.id },
            { roleName: employee.designation, isRoleBased: true },
          ],
        },
      });

      // Build a lookup map for GL (name → accountCode) that the GL writer will use
      const componentAccountMap = {};
      masterComponents.forEach(comp => {
        const amount = comp.calculationType === "percentage"
          ? (parseFloat(comp.amount) / 100) * basicSalary
          : parseFloat(comp.amount);

        componentAccountMap[comp.name] = { accountCode: comp.accountCode, type: comp.type, resolvedAmount: amount };

        if (comp.type === "allowance") {
          allowancesBreakdown[comp.name] = (allowancesBreakdown[comp.name] || 0) + amount;
          if (comp.isTaxable !== false && comp.isTaxable !== 0) {
            totalTaxableAllowances += amount;
          }
        } else {
          deductionsBreakdown[comp.name] = (deductionsBreakdown[comp.name] || 0) + amount;
        }
      });

      // 3. Approved bonuses this month
      const activeBonuses = await db.bonuses.findAll({
        where: {
          employeeId: employee.id,
          facilityId,
          status: "approved",
          bonusDate: {
            [Op.and]: [
              { [Op.gte]: new Date(year, month - 1, 1) },
              { [Op.lt]:  new Date(year, month,     1) },
            ],
          },
        },
      });

      let totalBonuses = 0;
      let totalTaxableBonuses = 0;
      activeBonuses.forEach(bonus => {
        const amount = bonus.calculationType === "percentage"
          ? (parseFloat(bonus.amount) / 100) * basicSalary
          : parseFloat(bonus.amount);
        const key = bonus.bonusType || bonus.reason || "Bonus";
        bonusBreakdown[key] = (bonusBreakdown[key] || 0) + amount;
        totalBonuses += amount;
        if (bonus.isTaxable !== false && bonus.isTaxable !== 0) {
          totalTaxableBonuses += amount;
        }
      });

      // ── Totals & Statutory Deductions ─────────────────────────────────
      const totalAllowances     = sumBreakdown(allowancesBreakdown);
      const totalDeductionsMaster = sumBreakdown(deductionsBreakdown);

      const overtime = calculateOvertime(overtimeHours, basicSalary, salaryStructure.overtimeRate);
      const grossPay = basicSalary + totalAllowances + totalBonuses + overtime;

      const existingRecord = await db.payroll.findOne({
        where: {
          employeeId: employee.id,
          facilityId,
          month: parseInt(month, 10),
          year: parseInt(year, 10),
        },
      });

      let computedPaye = 0;
      let paye = 0;
      let pension = 0;

      const payeProfile = payeProfileMap[employee.id];
      const hasPayeProfile =
        payeProfile &&
        (payeProfile.basicSalary > 0 ||
          payeProfile.housingAllowance > 0 ||
          payeProfile.transportAllowance > 0 ||
          payeProfile.otherAllowances > 0 ||
          payeProfile.bonus > 0);

      // Compute statutory amounts (may be discarded when auto-calc is off)
      if (hasPayeProfile) {
        const profileForCalc = {
          ...payeProfile,
          basicSalary: payeProfile.basicSalary > 0 ? payeProfile.basicSalary : basicSalary,
          // Prefer this month's approved bonuses when present
          bonus: totalBonuses > 0 ? totalBonuses : payeProfile.bonus,
          isBonusTaxable:
            totalBonuses > 0
              ? totalTaxableBonuses > 0
              : payeProfile.isBonusTaxable !== false,
          taxableBonus: totalBonuses > 0 ? totalTaxableBonuses : undefined,
          nonTaxableBonus:
            totalBonuses > 0 ? totalBonuses - totalTaxableBonuses : undefined,
        };
        const calc = computePAYE(
          payeSettingsController.buildEmployeeCalcInput(profileForCalc, payeSettings)
        );
        computedPaye = calc.monthlyTax;
        pension = calc.pension / 12;
      } else {
        const taxableGross = basicSalary + totalTaxableAllowances + totalTaxableBonuses + overtime;
        computedPaye = calculatePAYE(taxableGross, salaryStructure.payeRate);
        pension = calculatePension(taxableGross, salaryStructure.pensionRate);
      }

      // PAYE application rules:
      // - Auto-calc ON  → use formula result
      // - Auto-calc OFF → only apply manual payeOverride; otherwise 0
      if (payeAutoCalculation) {
        paye = computedPaye;
      } else if (existingRecord?.payeOverride != null && existingRecord.payeOverride !== "") {
        paye = parseFloat(existingRecord.payeOverride) || 0;
        pension = 0; // pension also follows auto-calc unless you later add a pension override
      } else {
        paye = 0;
        pension = 0;
      }

      // ── Loan Repayments via Salary Deduction ───────────────────────────
      let loanRepaymentTotal = 0;
      const activeLoans = await db.loans.findAll({
        where: {
          employeeId: employee.id,
          facilityId,
          status: { [Op.in]: ["Approved", "Repaying"] },
          repaymentMethod: "Salary Deduction",
        },
      });

      for (const loan of activeLoans) {
        const remainingBalance = parseFloat(loan.amount) - parseFloat(loan.amountPaid || 0);
        if (remainingBalance > 0) {
          const deduction = Math.min(parseFloat(loan.monthlyDeductionAmount || 0), remainingBalance);
          if (deduction > 0) {
            loanRepaymentTotal += deduction;
            await db.loan_repayments.create({
              id: uuidv4(),
              loanId: loan.id,
              facilityId,
              amount: deduction,
              paymentMethod: "Payroll Deduction",
              reference: `Payroll ${month}/${year}`,
              createdBy,
            });
            const newAmountPaid = parseFloat(loan.amountPaid || 0) + deduction;
            loan.amountPaid = newAmountPaid;
            loan.status = newAmountPaid >= parseFloat(loan.amount) ? "Paid Off" : "Repaying";
            await loan.save();
          }
        }
      }

      const totalDeductionsFinal = totalDeductionsMaster + paye + pension + loanRepaymentTotal;
      const netPay             = Math.max(0, grossPay - totalDeductionsFinal);

      // ── Create or Update Payroll Record ───────────────────────────────
      let payroll;
      const payrollDataObj = {
        basicSalary: parseFloat(basicSalary.toFixed(2)),
        allowances: parseFloat(totalAllowances.toFixed(2)),
        allowance_details: allowancesBreakdown,
        overtime: parseFloat(overtime.toFixed(2)),
        deductions: parseFloat(totalDeductionsFinal.toFixed(2)),
        deduction_details: deductionsBreakdown,
        bonuses: parseFloat(totalBonuses.toFixed(2)),
        bonus_details: bonusBreakdown,
        loanRepayment: parseFloat(loanRepaymentTotal.toFixed(2)),
        paye: parseFloat(paye.toFixed(2)),
        computedPaye: parseFloat(computedPaye.toFixed(2)),
        pension: parseFloat(pension.toFixed(2)),
        netPay: parseFloat(netPay.toFixed(2)),
        grossPay: parseFloat(grossPay.toFixed(2)),
        workingDays: totalWorkingDaysInMonth,
        presentDays,
        overtimeHours,
        paymentType,
        paymentNote,
        status: "Draft",
        processedAt: new Date(),
        updatedBy: createdBy,
      };

      if (existingRecord) {
        if (existingRecord.status === 'Paid') {
            console.warn(`[Payroll] Employee ${employee.employeeId} already paid — skipped update`);
            continue;
        }
        payroll = await existingRecord.update(payrollDataObj);
      } else {
        payroll = await db.payroll.create({
          id: uuidv4(),
          employeeId: employee.id,
          facilityId,
          month: parseInt(month),
          year: parseInt(year),
          ...payrollDataObj,
          createdBy,
        });
      }

      // Convert to plain object to ensure custom properties like 'employee' are preserved in JSON response
      const payrollJson = payroll.get({ plain: true });
      payrollJson.employee = { 
        firstName: employee.firstName, 
        lastName: employee.lastName, 
        employeeId: employee.employeeId,
        designation: employee.designation,
        photoUrl: employee.photoUrl,
        bankName: employee.bankName,
        bankAccount: employee.bankAccount,
      };

      payrollResults.push(payrollJson);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    const summary = {
      month,
      year,
      totalEmployees:  payrollResults.length,
      totalGrossPay:   payrollResults.reduce((s, p) => s + parseFloat(p.grossPay),  0),
      totalNetPay:     payrollResults.reduce((s, p) => s + parseFloat(p.netPay),    0),
      totalPAYE:       payrollResults.reduce((s, p) => s + parseFloat(p.paye),      0),
      totalPension:    payrollResults.reduce((s, p) => s + parseFloat(p.pension),   0),
      totalDeductions: payrollResults.reduce((s, p) => s + parseFloat(p.deductions), 0),
    };

    // ── General Ledger Entries ────────────────────────────────────────────
    // GL Entries are now DEFERRED to the Payment Release stage (markPayrollAsPaid)

    res.json({
      success: true,
      message: `Payroll processed successfully for ${payrollResults.length} employee(s)`,
      data: {
        ...summary,
        payrolls: payrollResults,
        accountingEntries: null,
        glBalanced: null,
      },
    });
  } catch (error) {
    console.error("Error running payroll:", error);
    res.status(500).json({
      success: false,
      message: "Error running payroll",
      error: error.message,
    });
  }
};

// Get payroll for a specific month
exports.getPayrollByMonth = async (req, res) => {
  try {
    // Check if user is authenticated

    const { month, year } = req.params;
    const {facilityId} = req.query;

    const payrolls = await db.payroll.findAll({
      where: {
        facilityId,
        month: parseInt(month),
        year: parseInt(year),
      },
      include: [
        {
          model: db.employees,
          as: "employee",
          attributes: [
            "id",
            "employeeId",
            "firstName",
            "lastName",
            "designation",
            "bankName",
            "bankAccount",
            "bankCode",
          ],
          include: [
            {
              model: db.Department,
              as: "department",
              attributes: ["departmentName"],
            },
          ],
        },
      ],
      order: [["employee", "firstName", "ASC"]],
    });

    const summary = {
      totalEmployees: payrolls.length,
      totalGrossPay: payrolls.reduce(
        (sum, p) => sum + parseFloat(p.grossPay),
        0
      ),
      totalNetPay: payrolls.reduce((sum, p) => sum + parseFloat(p.netPay), 0),
      totalPAYE: payrolls.reduce((sum, p) => sum + parseFloat(p.paye), 0),
      totalPension: payrolls.reduce((sum, p) => sum + parseFloat(p.pension), 0),
      totalDeductions: payrolls.reduce(
        (sum, p) => sum + parseFloat(p.deductions),
        0
      ),
    };

    res.json({
      success: true,
      data: {
        payrolls,
        summary,
      },
    });
  } catch (error) {
    console.error("Error fetching payroll:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching payroll",
      error: error.message,
    });
  }
};

// Get all payroll batches summary
exports.getAllPayrollBatches = async (req, res) => {
  try {
    const facilityId = req.user?.facilityId || req.query.facilityId;

    if (!facilityId) {
       return res.status(400).json({ success: false, message: "Facility ID required" });
    }

    const batches = await db.payroll.findAll({
      where: { facilityId },
      attributes: [
        'month', 
        'year', 
        'status',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'totalEmployees'],
        [db.sequelize.fn('SUM', db.sequelize.col('grossPay')), 'totalGrossPay'],
        [db.sequelize.fn('SUM', db.sequelize.col('netPay')), 'totalNetPay'],
      ],
      group: ['month', 'year', 'status'],
      order: [['year', 'DESC'], ['month', 'DESC']],
    });

    res.json({
      success: true,
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching payroll batches:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching payroll batches",
      error: error.message,
    });
  }
};

// Get payslip for specific employee
exports.getPayslip = async (req, res) => {
  try {
    const { id } = req.params;
    const facilityId = req.user?.facilityId || req.query.facilityId;

    const payroll = await db.payroll.findOne({
      where: { id, facilityId },
      include: [
        {
          model: db.employees,
          as: "employee",
          include: [
            {
              model: db.Department,
              as: "department",
              attributes: ["departmentName"],
            },
          ],
        },
      ],
    });

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payslip not found",
      });
    }

    res.json({
      success: true,
      data: payroll,
    });
  } catch (error) {
    console.error("Error fetching payslip:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching payslip",
      error: error.message,
    });
  }
};

// Get payroll history for a specific employee
exports.getPayrollHistory = async (req, res) => {
  try {
    const { employeeId } = req.query;
    const facilityId = req.user?.facilityId || req.query.facilityId;

    if (!employeeId || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and Facility ID are required",
      });
    }

    const payrolls = await db.payroll.findAll({
      where: { 
        employeeId, 
        facilityId 
      },
      order: [["year", "DESC"], ["month", "DESC"]],
    });

    res.json({
      success: true,
      data: payrolls,
    });
  } catch (error) {
    console.error("Error fetching payroll history:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching payroll history",
      error: error.message,
    });
  }
};

// Mark payroll as paid
exports.markPayrollAsPaid = async (req, res) => {
  try {
    // Check if user is authenticated

    const { month, year, facilityId, userId, bankAccountId, mode_of_payment, cheque_number, payment_date, accountHead } = req.body;
    const updatedBy = userId;

    let sourceAccountCode = null;
    let payrollTemplate = null;
    
    if (["bank", "cheque"].includes(mode_of_payment) && bankAccountId) {
      const bankAccount = await db.bank_account.findOne({ where: { id: bankAccountId, facilityId } });
      if (bankAccount) {
        sourceAccountCode = bankAccount.head;
        payrollTemplate = bankAccount.payroll_template;
      }
    } else if (mode_of_payment === "cash" && accountHead?.head) {
      sourceAccountCode = accountHead.head;
    }

    const payrolls = await db.payroll.findAll({
      where: {
        facilityId,
        month: parseInt(month),
        year: parseInt(year),
        status: "Processed",
      },
    });

    if (payrolls.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No processed payroll found for this month",
      });
    }

    // Update all payrolls to paid status
    await db.payroll.update(
      {
        status: "Paid",
        paidAt: new Date(),
        updatedBy,
      },
      {
        where: {
          facilityId,
          month: parseInt(month),
          year: parseInt(year),
          status: "Processed",
        },
      }
    );

    // ── Generate General Ledger Entries ──────────────────────────────────
    const accountingResult = await payrollAccounting.createPayrollJournalEntries(
      { month, year, payrolls },
      facilityId,
      updatedBy,
      sourceAccountCode,
      bankAccountId,
      mode_of_payment,
      cheque_number,
      payment_date
    );

    if (!accountingResult.success) {
      console.error("[Payroll] GL entry failed on payment release:", accountingResult.message);
    } else if (!accountingResult.balanced) {
      console.warn("[Payroll] GL imbalance detected on payment release");
    }

    res.json({
      success: true,
      message: "Payroll marked as paid successfully",
      data: {
        month,
        year,
        totalRecords: payrolls.length,
        payrollTemplate, // Send template string (e.g. Base64) to the frontend for download extraction
      },
    });
  } catch (error) {
    console.error("Error marking payroll as paid:", error);
    res.status(500).json({
      success: false,
      message: "Error marking payroll as paid",
      error: error.message,
    });
  }
};

// Helper functions for calculations
/** Normalize salary-structure component JSON into { name: amount } */
function normalizeComponentMap(raw) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return {};
    }
  }
  if (!data) return {};

  // Array of { name, amount } / { title, value }
  if (Array.isArray(data)) {
    const map = {};
    data.forEach((item, idx) => {
      if (item == null) return;
      if (typeof item === "number") {
        map[`Item ${idx + 1}`] = item;
        return;
      }
      if (typeof item === "object") {
        const name =
          item.name || item.title || item.label || item.type || `Item ${idx + 1}`;
        const val =
          item.amount ?? item.value ?? item.rate ?? item.percent ?? item;
        map[name] = val;
      }
    });
    return map;
  }

  if (typeof data === "object") return data;
  return {};
}

function resolveComponentAmount(val, basicSalary) {
  if (val == null) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (typeof val === "object") {
    return resolveComponentAmount(
      val.amount ?? val.value ?? val.rate ?? 0,
      basicSalary
    );
  }
  if (typeof val === "string") {
    if (val.includes("%")) {
      const percentage = parseFloat(val.replace("%", ""));
      return Number.isFinite(percentage) ? (percentage / 100) * basicSalary : 0;
    }
    const numericVal = parseFloat(val);
    return Number.isFinite(numericVal) ? numericVal : 0;
  }
  return 0;
}

function sumBreakdown(breakdown) {
  return Object.values(breakdown || {}).reduce((s, v) => {
    const n = parseFloat(v);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function calculateAllowances(allowances, basicSalary) {
  const map = normalizeComponentMap(allowances);
  let total = 0;
  for (const value of Object.values(map)) {
    total += resolveComponentAmount(value, basicSalary);
  }
  return total;
}

function calculateDeductions(deductions, basicSalary) {
  const map = normalizeComponentMap(deductions);
  let total = 0;
  for (const value of Object.values(map)) {
    total += resolveComponentAmount(value, basicSalary);
  }
  return total;
}

function calculateOvertime(overtimeHours, basicSalary, overtimeRate = 1.5) {
  const hourlyRate = basicSalary / 176; // Assuming 176 working hours per month
  return overtimeHours * hourlyRate * overtimeRate;
}

function calculatePAYE(grossPay, payeRate = 0) {
  // NOTE: Temporarily treating payeRate as absolute money value as requested.
  // This will be reverted to percentage-based or tax-bracket calculation in the future.
  return parseFloat(payeRate) || 0;
}

function calculatePension(grossPay, pensionRate = 0) {
  // NOTE: Temporarily treating pensionRate as absolute money value as requested.
  // This will be reverted to percentage-based calculation in the future.
  return parseFloat(pensionRate) || 0;
}

// Update individual payroll status
exports.updatePayrollStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, facilityId, userId } = req.body;

    if (!status || !facilityId) {
      return res.status(400).json({ success: false, message: "Status and Facility ID are required" });
    }

    const payroll = await db.payroll.findOne({
      where: { id, facilityId }
    });

    if (!payroll) {
      return res.status(404).json({ success: false, message: "Payroll record not found" });
    }

    if (payroll.status === 'Paid' && status !== 'Paid') {
       return res.status(400).json({ success: false, message: "Cannot change status of a paid record" });
    }

    await payroll.update({
      status,
      updatedBy: userId
    });

    res.json({
      success: true,
      message: `Payroll status updated to ${status}`,
      data: payroll
    });
  } catch (error) {
    console.error("Error updating payroll status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating payroll status",
      error: error.message
    });
  }
};
// Batch update payroll status (e.g., Draft -> Processed)
exports.batchUpdateStatus = async (req, res) => {
  try {
    const { ids, status, facilityId, userId } = req.body;

    if (!ids || !Array.isArray(ids) || !status || !facilityId) {
      return res.status(400).json({ success: false, message: "IDs, Status, and Facility ID are required" });
    }

    const [updatedCount] = await db.payroll.update(
      { status, updatedBy: userId },
      { where: { id: { [Op.in]: ids }, facilityId } }
    );

    res.json({
      success: true,
      message: `${updatedCount} payroll record(s) updated to ${status}`,
      data: { updatedCount }
    });
  } catch (error) {
    console.error("Error batch updating payroll status:", error);
    res.status(500).json({
      success: false,
      message: "Error batch updating payroll status",
      error: error.message
    });
  }
};

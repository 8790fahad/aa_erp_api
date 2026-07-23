const db = require("../models");

// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL ACCOUNTING — General Ledger Integration
//
// Maps to the real `general_ledger` table via db.GeneralLedger with fields:
//   account_code, account_subhead, dr, cr, account_description,
//   transaction_description, reference_number, purpose_of_payment,
//   facility_id, transaction_ref, type, created_by, status
//
// Double-entry pattern per employee:
//   DR  Salary Expense      (basicSalary)        — salary structure accountCode
//   DR  Allowance Expense   (per component)      — allowance.accountCode
//   DR  Overtime Expense    (overtime)            — default code
//   DR  Bonus Expense       (per bonus)           — default code
//   CR  Net Pay Payable     (netPay)              — bank / wages payable
//   CR  PAYE Tax Payable    (paye)                — PAYE liability
//   CR  Pension Payable     (pension)             — pension liability
//   CR  Loan Deduction      (loanRepayment)       — loan payable
//   CR  Other Deduction     (per deduction comp.) — deduction.accountCode
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CODES = {
  SALARY_EXPENSE:    "6010", // Wages & Salaries Expense
  ALLOWANCE_EXPENSE: "6011", // Staff Allowances Expense
  BONUS_EXPENSE:     "6012", // Bonus Expense
  OVERTIME_EXPENSE:  "6013", // Overtime Expense
  BANK_ACCOUNT:      "1020", // Bank / Cash (Net Pay)
  PAYE_PAYABLE:      "2110", // PAYE Tax Payable (Liability)
  PENSION_PAYABLE:   "2120", // Pension Payable (Liability)
  LOAN_DEDUCTION:    "2130", // Staff Loan Deduction Payable
  OTHER_DEDUCTION:   "2140", // Other Deductions Payable
};

/**
 * Map a payroll GL line to the real general_ledger schema
 */
function buildGLLine({
  accountCode, accountSubhead, description, debit, credit,
  facilityId, reference, transactionRef, createdBy = "PAYROLL-SYSTEM", employeeId = null,
  bankAccountId = null, modeOfPayment = null, chequeNo = null, transactionDate = null,
  accountName = null,
}) {
  return {
    transaction_date:         transactionDate ? new Date(transactionDate) : new Date(),
    account_code:             accountCode || DEFAULT_CODES.SALARY_EXPENSE,
    account_subhead:          accountSubhead || "payroll",
    dr:                       parseFloat((debit  || 0).toFixed(2)),
    cr:                       parseFloat((credit || 0).toFixed(2)),
    account_description:      accountName || description,
    transaction_description:  description,
    reference_number:         reference ? reference.slice(0, 15) : null,
    purpose_of_payment:       "Payroll",
    payee:                    employeeId || "PAYROLL-BATCH",
    facility_id:              facilityId,
    transaction_ref:          transactionRef || reference || "PAYROLL",
    type:                     "expenses",
    created_by:               String(createdBy),
    status:                   "saved",
    bank_account_id:          bankAccountId || null,
    mode_of_payment:          modeOfPayment || null,
    cheque_number:            chequeNo || null,
  };
}

/**
 * Persist GL lines, skipping zero-value lines.
 * Returns count of persisted lines.
 */
async function persistLines(lines) {
  let count = 0;
  for (const line of lines) {
    if (line.dr === 0 && line.cr === 0) continue;
    try {
      await db.GeneralLedger.create(line);
      count++;
    } catch (err) {
      console.error(`[PayrollGL] Failed to persist line (${line.account_code}):`, err.message);
    }
  }
  return count;
}

// ───────────────────────────────────────────────────────────────────────────────
// MAIN: Create granular payroll journal entries
// Called once per payroll batch.
//
// payrollData.payrolls[] each has:
//   .basicSalary, .allowances, .deductions, .grossPay, .netPay
//   .paye, .pension, .loanRepayment, .overtime, .overtimeHours
//   .allowance_details {}, .deduction_details {}, .bonus_details {}
//   .masterComponents [{ name, type, accountCode, resolvedAmount }]
//   .salaryStructure { accountCode }
//   .employee { firstName, lastName, employeeId }
// ───────────────────────────────────────────────────────────────────────────────
exports.createPayrollJournalEntries = async (payrollData, facilityId, createdBy = "SYSTEM", sourceAccountCode = null, bankAccountId = null, modeOfPayment = null, chequeNo = null, transactionDate = null) => {
  try {
    const { month, year, payrolls = [] } = payrollData;
    const batchRef = `PAY-${month}-${year}`;
    const txDate   = transactionDate ? new Date(transactionDate) : new Date();
    const lines = [];

    let payePayableCode = DEFAULT_CODES.PAYE_PAYABLE;
    try {
      const payeSettings = await db.paye_settings.findOne({
        where: { facilityId, assessmentYear: parseInt(year, 10) },
      });
      if (payeSettings?.payeLedgerAccount) {
        payePayableCode = String(payeSettings.payeLedgerAccount).trim();
      }
    } catch (err) {
      console.warn("[PayrollGL] Could not load PAYE ledger account, using default:", err.message);
    }

    for (const p of payrolls) {
      const empId   = p.employeeId;
      const empName = [p.employee?.firstName, p.employee?.lastName].filter(Boolean).join(" ") || empId;
      const empRef  = `${batchRef}-${empId}`.slice(0, 15);
      const tRef    = `${batchRef}-${empId}`.slice(0, 100);

      // 1. DR Basic Salary Expense
      const salaryCode = p.salaryStructure?.accountCode || DEFAULT_CODES.SALARY_EXPENSE;
      if (parseFloat(p.basicSalary) > 0) {
        lines.push(buildGLLine({
          accountCode: salaryCode,
          accountSubhead: "payroll",
          description: `Basic Salary — ${empName} (${month}/${year})`,
          debit: parseFloat(p.basicSalary),
          credit: 0,
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
          transactionDate: txDate,
        }));
      }

      // 2. DR Overtime Expense
      if (parseFloat(p.overtime || 0) > 0) {
        lines.push(buildGLLine({
          accountCode: DEFAULT_CODES.OVERTIME_EXPENSE,
          accountSubhead: "payroll",
          description: `Overtime (${p.overtimeHours || 0}h) — ${empName} (${month}/${year})`,
          debit: parseFloat(p.overtime),
          credit: 0,
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
        }));
      }

      // 3. DR Allowance Expense lines — from allowance_details
      const allowanceDetails = typeof p.allowance_details === "string"
        ? JSON.parse(p.allowance_details || "{}") : (p.allowance_details || {});

      for (const [name, amount] of Object.entries(allowanceDetails)) {
        if (parseFloat(amount) <= 0) continue;
        const comp = (p.masterComponents || []).find(c => c.name === name && c.type === "allowance");
        lines.push(buildGLLine({
          accountCode: comp?.accountCode || DEFAULT_CODES.ALLOWANCE_EXPENSE,
          accountSubhead: "payroll",
          description: `${name} Allowance — ${empName} (${month}/${year})`,
          debit: parseFloat(amount),
          credit: 0,
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
        }));
      }

      // 4. DR Bonus Expense
      const bonusDetails = typeof p.bonus_details === "string"
        ? JSON.parse(p.bonus_details || "{}") : (p.bonus_details || {});

      for (const [name, amount] of Object.entries(bonusDetails)) {
        if (parseFloat(amount) <= 0) continue;
        lines.push(buildGLLine({
          accountCode: DEFAULT_CODES.BONUS_EXPENSE,
          accountSubhead: "payroll",
          description: `${name} Bonus — ${empName} (${month}/${year})`,
          debit: parseFloat(amount),
          credit: 0,
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
        }));
      }

      // 5. CR Net Pay — Actual cash/bank out
      if (parseFloat(p.netPay) > 0) {
        lines.push(buildGLLine({
          accountCode: sourceAccountCode || DEFAULT_CODES.BANK_ACCOUNT,
          accountSubhead: "payroll",
          description: `Net Pay — ${empName} (${month}/${year})`,
          debit: 0,
          credit: parseFloat(p.netPay),
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
          bankAccountId,
          modeOfPayment,
          chequeNo,
          transactionDate: txDate,
        }));
      }

      // 6. CR PAYE Tax Payable
      if (parseFloat(p.paye || 0) > 0) {
        lines.push(buildGLLine({
          accountCode: payePayableCode,
          accountSubhead: "tax",
          description: `PAYE Tax — ${empName} (${month}/${year})`,
          debit: 0,
          credit: parseFloat(p.paye),
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
          transactionDate: txDate,
        }));
      }

      // 7. CR Pension Payable
      if (parseFloat(p.pension || 0) > 0) {
        lines.push(buildGLLine({
          accountCode: DEFAULT_CODES.PENSION_PAYABLE,
          accountSubhead: "payable",
          description: `Pension — ${empName} (${month}/${year})`,
          debit: 0,
          credit: parseFloat(p.pension),
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
          transactionDate: txDate,
        }));
      }

      // 8. CR Loan Deduction Payable
      if (parseFloat(p.loanRepayment || 0) > 0) {
        lines.push(buildGLLine({
          accountCode: DEFAULT_CODES.LOAN_DEDUCTION,
          accountSubhead: "payable",
          description: `Loan Repayment — ${empName} (${month}/${year})`,
          debit: 0,
          credit: parseFloat(p.loanRepayment),
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
          transactionDate: txDate,
        }));
      }

      // 9. CR Other Deductions — from deduction_details
      // IMPORTANT: skip entries that match statutory items already credited in
      // sections 6 (PAYE), 7 (Pension), 8 (Loan) to avoid double-counting.
      const STATUTORY_KEYS = new Set([
        "paye", "tax", "income tax", "personal income tax",
        "pension", "nhf", "nsitf",
        "loan", "loan repayment", "staff loan",
      ]);

      const deductionDetails = typeof p.deduction_details === "string"
        ? JSON.parse(p.deduction_details || "{}") : (p.deduction_details || {});

      for (const [name, amount] of Object.entries(deductionDetails)) {
        if (parseFloat(amount) <= 0) continue;
        // Skip statutory items — already handled in sections 6, 7, 8
        if (STATUTORY_KEYS.has(name.toLowerCase().trim())) continue;
        const comp = (p.masterComponents || []).find(c => c.name === name && c.type === "deduction");
        lines.push(buildGLLine({
          accountCode: comp?.accountCode || DEFAULT_CODES.OTHER_DEDUCTION,
          accountSubhead: "payable",
          description: `${name} Deduction — ${empName} (${month}/${year})`,
          debit: 0,
          credit: parseFloat(amount),
          facilityId, reference: empRef, transactionRef: tRef, createdBy, employeeId: empId,
        }));
      }

      // ── Per-employee balance assertion ───────────────────────────────────
      // Expected: DR (grossPay) = CR (netPay + paye + pension + loan + masterDeductions)
      const empDR = parseFloat(p.grossPay || 0);
      const empCR = parseFloat(p.netPay || 0)
        + parseFloat(p.paye || 0)
        + parseFloat(p.pension || 0)
        + parseFloat(p.loanRepayment || 0)
        + Object.values(deductionDetails)
            .filter((_, i) => !STATUTORY_KEYS.has(Object.keys(deductionDetails)[i]?.toLowerCase().trim()))
            .reduce((s, v) => s + parseFloat(v || 0), 0);

      const empDiff = Math.abs(empDR - empCR);
      if (empDiff > 0.10) {
        console.warn(`[PayrollGL] Employee ${empId} computed imbalance: DR(grossPay)=${empDR.toFixed(2)}, CR(sum)=${empCR.toFixed(2)}, diff=${empDiff.toFixed(2)}`);
      }
    }

    const savedCount = await persistLines(lines);

    // ── Balance verification ────────────────────────────────────────────────
    // Per employee: DR (basicSalary + overtime + allowances + bonuses)
    //             = CR (netPay + paye + pension + loanRepayment + deductions)
    // Any gap means payroll data is inconsistent (likely rounding).
    let totalDebit  = 0;
    let totalCredit = 0;
    for (const p of payrolls) {
      const empId   = p.employeeId;
      const empLines = lines.filter(l => l.payee === (empId || "PAYROLL-BATCH"));
      const empDR = empLines.reduce((s, l) => s + l.dr, 0);
      const empCR = empLines.reduce((s, l) => s + l.cr, 0);
      const diff   = Math.abs(empDR - empCR);
      if (diff > 0.05) {
        console.warn(`[PayrollGL] Employee ${empId} imbalance: DR=${empDR.toFixed(2)}, CR=${empCR.toFixed(2)}, diff=${diff.toFixed(2)}`);
      }
      totalDebit  += empDR;
      totalCredit += empCR;
    }

    const balanced = Math.abs(totalDebit - totalCredit) < 0.05;

    if (!balanced) {
      console.warn(`[PayrollGL] Batch ${batchRef} imbalance: DR=${totalDebit.toFixed(2)}, CR=${totalCredit.toFixed(2)}, diff=${Math.abs(totalDebit - totalCredit).toFixed(2)}`);
    } else {
      console.log(`[PayrollGL] Batch ${batchRef} balanced: DR=CR=${totalDebit.toFixed(2)} (${savedCount} lines, ${payrolls.length} employees)`);
    }

    // --- Fetch and Map Account Names ---
    const uniqueCodes = [...new Set(lines.map(l => l.account_code))];
    const accounts = await db.Account.findAll({
      where: { head: uniqueCodes, facilityId }
    });
    const accountMap = accounts.reduce((acc, a) => {
      acc[a.head] = a.description;
      return acc;
    }, {});

    // Update account_description for each line with the actual account name
    lines.forEach(line => {
      if (accountMap[line.account_code]) {
        line.account_description = accountMap[line.account_code];
      }
    });

    return {
      success: true,
      message: `${lines.length} GL lines created (${payrolls.length} employees)${balanced ? "" : " — imbalance detected"}`,
      entries: lines,
      balanced,
      totalDebit,
      totalCredit,
    };
  } catch (error) {
    console.error("[PayrollGL] Error:", error);
    return { success: false, message: "Error creating payroll GL entries", error: error.message };
  }
};

// ───────────────────────────────────────────────────────────────────────────────
// Get payroll GL summary for a given month/year
// ───────────────────────────────────────────────────────────────────────────────
exports.getPayrollAccountingSummary = async (month, year, facilityId) => {
  try {
    const entries = await db.GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        transaction_ref: { [db.Sequelize.Op.like]: `PAY-${month}-${year}%` },
      },
      order: [["created_at", "ASC"]],
    });

    const byAccount = {};
    entries.forEach(e => {
      const code = e.account_code;
      if (!byAccount[code]) byAccount[code] = { account_code: code, account_subhead: e.account_subhead, dr: 0, cr: 0, count: 0 };
      byAccount[code].dr    += parseFloat(e.dr || 0);
      byAccount[code].cr    += parseFloat(e.cr || 0);
      byAccount[code].count += 1;
    });

    const totalDebit  = entries.reduce((s, e) => s + parseFloat(e.dr || 0), 0);
    const totalCredit = entries.reduce((s, e) => s + parseFloat(e.cr || 0), 0);

    return {
      success: true,
      data: { month, year, entries, accountTotals: Object.values(byAccount), totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.05 },
    };
  } catch (error) {
    return { success: false, message: "Error fetching GL summary", error: error.message };
  }
};

// ───────────────────────────────────────────────────────────────────────────────
// Reverse payroll GL entries
// ───────────────────────────────────────────────────────────────────────────────
exports.reversePayrollJournalEntries = async (month, year, facilityId, createdBy = "SYSTEM") => {
  try {
    const entries = await db.GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        transaction_ref: { [db.Sequelize.Op.like]: `PAY-${month}-${year}%` },
        type: "expenses",
      },
    });

    const reversals = [];
    for (const e of entries) {
      const rev = await db.GeneralLedger.create({
        transaction_date:        new Date(),
        account_code:            e.account_code,
        account_subhead:         e.account_subhead,
        dr:                      parseFloat(e.cr || 0),
        cr:                      parseFloat(e.dr || 0),
        account_description:     `REVERSAL — ${e.account_description}`,
        transaction_description: `REVERSAL — ${e.transaction_description}`,
        reference_number:        e.reference_number,
        purpose_of_payment:      "Payroll Reversal",
        payee:                   e.payee,
        facility_id:             e.facility_id,
        transaction_ref:         `REV-${e.transaction_ref}`.slice(0, 100),
        type:                    "journal_entry",
        created_by:              String(createdBy),
        status:                  "saved",
      });
      reversals.push(rev);
    }

    return { success: true, message: `${reversals.length} reversal entries created`, entries: reversals };
  } catch (error) {
    return { success: false, message: "Error reversing GL entries", error: error.message };
  }
};

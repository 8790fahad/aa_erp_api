const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");

function getDb() {
  return require("../models");
}

const PAYROLL_DEDUCTION_METHOD = "Payroll Deduction";
const ACTIVE_LOAN_STATUSES = ["Approved", "Repaying"];

function payrollPeriodRef(month, year) {
  return `Payroll ${month}/${year}`;
}

function loanAmountDue(loan) {
  return parseFloat(loan?.amount || 0) + parseFloat(loan?.profit || 0);
}

function loanOutstanding(loan) {
  return loanAmountDue(loan) - parseFloat(loan?.amountPaid || 0);
}

function loanAppliesInPeriod(loan, month, year) {
  if (!loan?.startDate) return true;
  const start = new Date(loan.startDate);
  if (Number.isNaN(start.getTime())) return true;
  const startYm = start.getFullYear() * 12 + start.getMonth();
  const periodYm = parseInt(year, 10) * 12 + (parseInt(month, 10) - 1);
  return periodYm >= startYm;
}

function periodDeductionAmount(loan, month, year) {
  if (!loanAppliesInPeriod(loan, month, year)) return 0;
  const remaining = loanOutstanding(loan);
  if (remaining <= 0) return 0;
  const monthly = parseFloat(loan.monthlyDeductionAmount);
  if (!Number.isFinite(monthly) || monthly <= 0) return 0;
  return Math.min(monthly, remaining);
}

function sumPeriodDeductions(loans, month, year) {
  return (loans || []).reduce(
    (sum, loan) => sum + periodDeductionAmount(loan, month, year),
    0,
  );
}

function allocatePeriodDeductions(loans, month, year, deductionTotal) {
  let remainingToApply = parseFloat(deductionTotal || 0);
  const allocations = [];
  if (!Number.isFinite(remainingToApply) || remainingToApply <= 0) {
    return allocations;
  }

  for (const loan of loans || []) {
    if (remainingToApply <= 0) break;
    if (!loanAppliesInPeriod(loan, month, year)) continue;
    const remainingBalance = loanOutstanding(loan);
    if (remainingBalance <= 0) continue;
    const monthly = parseFloat(loan.monthlyDeductionAmount);
    if (!Number.isFinite(monthly) || monthly <= 0) continue;
    const applyAmt = Math.min(remainingToApply, monthly, remainingBalance);
    if (applyAmt <= 0) continue;
    allocations.push({
      loanId: loan.id,
      loan,
      amount: parseFloat(applyAmt.toFixed(2)),
    });
    remainingToApply -= applyAmt;
  }

  return allocations;
}

async function findSalaryDeductionLoans(employeeId, facilityId, statuses = ACTIVE_LOAN_STATUSES) {
  const db = getDb();
  return db.loans.findAll({
    where: {
      employeeId,
      facilityId,
      status: { [Op.in]: statuses },
      repaymentMethod: "Salary Deduction",
    },
    order: [["createdAt", "ASC"]],
  });
}

async function previewEmployeeLoanDeduction({ employeeId, facilityId, month, year }) {
  const loans = await findSalaryDeductionLoans(employeeId, facilityId);
  return parseFloat(sumPeriodDeductions(loans, month, year).toFixed(2));
}

function groupLoansByEmployeeId(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row.employeeId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

/** One query for all staff instead of one loan lookup per employee. */
async function previewEmployeeLoanDeductionsBatch({
  employeeIds,
  facilityId,
  month,
  year,
}) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  const totals = new Map();
  if (!ids.length) return totals;

  const db = getDb();
  const loans = await db.loans.findAll({
    where: {
      employeeId: { [Op.in]: ids },
      facilityId,
      status: { [Op.in]: ACTIVE_LOAN_STATUSES },
      repaymentMethod: "Salary Deduction",
    },
    order: [["createdAt", "ASC"]],
  });
  const byEmployee = groupLoansByEmployeeId(loans);
  for (const id of ids) {
    const key = String(id);
    totals.set(
      key,
      parseFloat(sumPeriodDeductions(byEmployee.get(key) || [], month, year).toFixed(2))
    );
  }
  return totals;
}

async function applyPayrollLoanDeductionsBatch({ payrollRows, facilityId, userId }) {
  const drafts = (payrollRows || []).filter(
    (row) => parseFloat(row.loanRepayment || 0) > 0
  );
  if (!drafts.length) return [];

  const employeeIds = [...new Set(drafts.map((row) => row.employeeId))];
  const periodRefs = [
    ...new Set(drafts.map((row) => payrollPeriodRef(row.month, row.year))),
  ];

  const db = getDb();
  const [allLoans, existingRepayments] = await Promise.all([
    db.loans.findAll({
      where: {
        employeeId: { [Op.in]: employeeIds },
        facilityId,
        status: { [Op.in]: ACTIVE_LOAN_STATUSES },
        repaymentMethod: "Salary Deduction",
      },
      order: [["createdAt", "ASC"]],
    }),
    db.loan_repayments.findAll({
      where: {
        facilityId,
        paymentMethod: PAYROLL_DEDUCTION_METHOD,
        reference: { [Op.in]: periodRefs },
      },
    }),
  ]);

  const loansByEmployee = groupLoansByEmployeeId(allLoans);
  const repaidKeys = new Set(
    existingRepayments.map((r) => `${String(r.loanId)}|${r.reference}`)
  );
  const repaymentCreates = [];
  const loansToSave = new Map();
  const applied = [];

  for (const row of drafts) {
    const periodRef = payrollPeriodRef(row.month, row.year);
    const loans = loansByEmployee.get(String(row.employeeId)) || [];
    const allocations = allocatePeriodDeductions(
      loans,
      row.month,
      row.year,
      row.loanRepayment
    );
    for (const item of allocations) {
      const key = `${String(item.loanId)}|${periodRef}`;
      if (repaidKeys.has(key)) continue;
      repaymentCreates.push({
        id: uuidv4(),
        loanId: item.loanId,
        facilityId,
        amount: item.amount,
        profit: 0,
        paymentMethod: PAYROLL_DEDUCTION_METHOD,
        reference: periodRef,
        createdBy: userId,
      });
      repaidKeys.add(key);
      const loan = item.loan;
      const newAmountPaid = parseFloat(loan.amountPaid || 0) + item.amount;
      loan.amountPaid = newAmountPaid;
      loan.status =
        newAmountPaid >= loanAmountDue(loan) - 0.0001 ? "Paid Off" : "Repaying";
      loansToSave.set(String(loan.id), loan);
      applied.push({ loanId: item.loanId, amount: item.amount });
    }
  }

  if (repaymentCreates.length) {
    await db.loan_repayments.bulkCreate(repaymentCreates);
  }
  await Promise.all([...loansToSave.values()].map((loan) => loan.save()));
  return applied;
}

async function reversePayrollLoanDeductionsBatch({ payrollRows, facilityId }) {
  const rows = payrollRows || [];
  if (!rows.length) return [];

  const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
  const periodRefs = [
    ...new Set(rows.map((row) => payrollPeriodRef(row.month, row.year))),
  ];
  const wanted = new Set(
    rows.map((row) => `${String(row.employeeId)}|${payrollPeriodRef(row.month, row.year)}`)
  );

  const db = getDb();
  const repayments = await db.loan_repayments.findAll({
    where: {
      facilityId,
      paymentMethod: PAYROLL_DEDUCTION_METHOD,
      reference: { [Op.in]: periodRefs },
    },
    include: [
      {
        model: db.loans,
        as: "loan",
        required: true,
        where: { employeeId: { [Op.in]: employeeIds }, facilityId },
      },
    ],
  });

  const loansToSave = new Map();
  const toDestroy = [];
  const reversed = [];

  for (const repayment of repayments) {
    const loan = repayment.loan;
    const matchKey = `${String(loan.employeeId)}|${repayment.reference}`;
    if (!wanted.has(matchKey)) continue;
    const newPaid = Math.max(
      0,
      parseFloat(loan.amountPaid || 0) - parseFloat(repayment.amount || 0)
    );
    loan.amountPaid = newPaid;
    if (newPaid <= 0.0001) {
      if (["Paid Off", "Repaying"].includes(loan.status)) {
        loan.status = "Approved";
      }
    } else if (loan.status === "Paid Off") {
      loan.status = "Repaying";
    }
    loansToSave.set(String(loan.id), loan);
    toDestroy.push(repayment);
    reversed.push({
      loanId: loan.id,
      amount: parseFloat(repayment.amount || 0),
    });
  }

  await Promise.all([...loansToSave.values()].map((loan) => loan.save()));
  await Promise.all(toDestroy.map((row) => row.destroy()));
  return reversed;
}

async function applyPayrollLoanDeductions({
  employeeId,
  facilityId,
  month,
  year,
  deductionTotal,
  userId,
}) {
  const deduction = parseFloat(deductionTotal || 0);
  if (!Number.isFinite(deduction) || deduction <= 0) return [];

  const db = getDb();
  const periodRef = payrollPeriodRef(month, year);
  const loans = await findSalaryDeductionLoans(employeeId, facilityId);
  const allocations = allocatePeriodDeductions(loans, month, year, deduction);
  const applied = [];

  for (const item of allocations) {
    const already = await db.loan_repayments.findOne({
      where: {
        loanId: item.loanId,
        facilityId,
        reference: periodRef,
        paymentMethod: PAYROLL_DEDUCTION_METHOD,
      },
    });
    if (already) continue;

    await db.loan_repayments.create({
      id: uuidv4(),
      loanId: item.loanId,
      facilityId,
      amount: item.amount,
      profit: 0,
      paymentMethod: PAYROLL_DEDUCTION_METHOD,
      reference: periodRef,
      createdBy: userId,
    });

    const loan = item.loan;
    const newAmountPaid = parseFloat(loan.amountPaid || 0) + item.amount;
    loan.amountPaid = newAmountPaid;
    loan.status =
      newAmountPaid >= loanAmountDue(loan) - 0.0001 ? "Paid Off" : "Repaying";
    await loan.save();
    applied.push({ loanId: item.loanId, amount: item.amount });
  }

  return applied;
}

async function reversePayrollLoanDeductions({ employeeId, facilityId, month, year }) {
  const db = getDb();
  const periodRef = payrollPeriodRef(month, year);
  const repayments = await db.loan_repayments.findAll({
    where: {
      facilityId,
      paymentMethod: PAYROLL_DEDUCTION_METHOD,
      reference: periodRef,
    },
    include: [
      {
        model: db.loans,
        as: "loan",
        required: true,
        where: { employeeId, facilityId },
      },
    ],
  });

  const reversed = [];
  for (const repayment of repayments) {
    const loan = repayment.loan;
    const newPaid = Math.max(
      0,
      parseFloat(loan.amountPaid || 0) - parseFloat(repayment.amount || 0),
    );
    loan.amountPaid = newPaid;
    if (newPaid <= 0.0001) {
      if (["Paid Off", "Repaying"].includes(loan.status)) {
        loan.status = "Approved";
      }
    } else if (loan.status === "Paid Off") {
      loan.status = "Repaying";
    }
    await loan.save();
    await repayment.destroy();
    reversed.push({ loanId: loan.id, amount: parseFloat(repayment.amount || 0) });
  }
  return reversed;
}

async function resolveDefaultLoanReceivable(facilityId) {
  const db = getDb();
  const namedDefault = await db.loan_setups.findOne({
    where: {
      facilityId,
      status: true,
      name: "Default loan receivable",
    },
  });
  if (namedDefault?.receivableHead) return namedDefault.receivableHead;

  const fallbackSetup = await db.loan_setups.findOne({
    where: { facilityId, status: true },
    order: [["createdAt", "ASC"]],
  });
  return fallbackSetup?.receivableHead || "112104";
}

async function loadPeriodLoanCredits({ employeeIds, facilityId, month, year }) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const db = getDb();
  const periodRef = payrollPeriodRef(month, year);
  const repayments = await db.loan_repayments.findAll({
    where: {
      facilityId,
      paymentMethod: PAYROLL_DEDUCTION_METHOD,
      reference: periodRef,
    },
    include: [
      {
        model: db.loans,
        as: "loan",
        required: true,
        where: { employeeId: { [Op.in]: ids }, facilityId },
      },
    ],
  });

  const byEmployee = {};
  for (const repayment of repayments) {
    const empId = repayment.loan?.employeeId;
    if (!empId) continue;
    if (!byEmployee[empId]) byEmployee[empId] = [];
    byEmployee[empId].push({
      accountCode: repayment.loan.receivableHead || null,
      amount: parseFloat(repayment.amount || 0),
    });
  }
  return byEmployee;
}

function allocateLoanCreditLines(credits, loanRepayment, fallbackAccount) {
  let remaining = parseFloat(loanRepayment || 0);
  const lines = [];
  if (!Number.isFinite(remaining) || remaining <= 0) return lines;

  for (const credit of credits || []) {
    if (remaining <= 0) break;
    const amount = Math.min(parseFloat(credit.amount || 0), remaining);
    if (amount <= 0) continue;
    const accountCode = credit.accountCode || fallbackAccount;
    if (!accountCode) continue;
    lines.push({
      accountCode,
      amount: parseFloat(amount.toFixed(2)),
    });
    remaining -= amount;
  }

  if (remaining > 0.009 && fallbackAccount) {
    lines.push({
      accountCode: fallbackAccount,
      amount: parseFloat(remaining.toFixed(2)),
    });
  }

  return lines;
}

module.exports = {
  PAYROLL_DEDUCTION_METHOD,
  payrollPeriodRef,
  loanAmountDue,
  loanOutstanding,
  loanAppliesInPeriod,
  periodDeductionAmount,
  sumPeriodDeductions,
  allocatePeriodDeductions,
  previewEmployeeLoanDeduction,
  previewEmployeeLoanDeductionsBatch,
  applyPayrollLoanDeductions,
  applyPayrollLoanDeductionsBatch,
  reversePayrollLoanDeductions,
  reversePayrollLoanDeductionsBatch,
  resolveDefaultLoanReceivable,
  loadPeriodLoanCredits,
  allocateLoanCreditLines,
};

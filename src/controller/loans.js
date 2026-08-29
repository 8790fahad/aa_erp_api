const db = require("../models");
const { v4: uuidv4 } = require("uuid");
const { getAndUpdateNumber } = require("../services/numberGen");

/** Loan disbursement voucher series in number_generator / general ledger */
const LOAN_NUMBER_PREFIX = "LM";

function formatLoanReference(seq) {
  const n = parseInt(seq, 10) || 1;
  return `LM-${n}`;
}

async function peekNextLoanReference(facilityId) {
  const rows = await db.sequelize.query(
    `SELECT code_no
     FROM number_generator
     WHERE prefix = :prefix AND facilityId = :facilityId
     LIMIT 1`,
    {
      replacements: { prefix: LOAN_NUMBER_PREFIX, facilityId },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );
  const next = rows?.[0]?.code_no ?? 1;
  return formatLoanReference(next);
}

async function allocateLoanReference(facilityId) {
  const seq = await getAndUpdateNumber(LOAN_NUMBER_PREFIX, facilityId);
  return formatLoanReference(seq);
}

/** Parse YYYY-MM (or Date) into the 1st of that month for loan deduction start. */
function parseLoanStartDate(startMonth, startDate) {
  if (startMonth != null && String(startMonth).trim()) {
    const raw = String(startMonth).trim();
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (!year || month < 1 || month > 12) return null;
    return new Date(year, month - 1, 1);
  }
  if (startDate) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  return null;
}

/**
 * Helper to record a GL transaction (Double Entry)
 */
async function recordGLTransaction({
  facilityId,
  accountDR,
  accountCR,
  amount,
  description,
  reference,
  createdBy,
  transactionRef
}) {
  // Fetch Account Names for Description
  const [drAcc, crAcc] = await Promise.all([
    db.Account.findOne({ where: { head: accountDR, facilityId } }),
    db.Account.findOne({ where: { head: accountCR, facilityId } })
  ]);

  const common = {
    transaction_date: new Date(),
    reference_number: reference ? reference.slice(0, 15) : null,
    purpose_of_payment: "Loan Transaction",
    facility_id: facilityId,
    transaction_ref: transactionRef || reference || "LOAN",
    created_by: String(createdBy),
    status: "saved",
    type: "journal_entry"
  };

  // Debit Entry
  await db.GeneralLedger.create({
    ...common,
    account_code: accountDR,
    account_subhead: "loan",
    dr: parseFloat(amount),
    cr: 0,
    account_description: drAcc?.description || description,
    transaction_description: description,
  });

  // Credit Entry
  await db.GeneralLedger.create({
    ...common,
    account_code: accountCR,
    account_subhead: "loan",
    dr: 0,
    cr: parseFloat(amount),
    account_description: crAcc?.description || description,
    transaction_description: description,
  });
}

// ==========================================
// LOAN SETUP (TEMPLATES)
// ==========================================

exports.createLoanSetup = async (req, res) => {
  try {
    const { name, description, amount, receivableHead, facilityId, userId } = req.body;
    
    if (!name || !receivableHead) {
      return res.status(400).json({ success: false, message: "Name and Receivable Account are required" });
    }

    const setup = await db.loan_setups.create({
      id: uuidv4(),
      name,
      description,
      amount,
      receivableHead,
      facilityId: facilityId || req.user?.facilityId,
      createdBy: userId || req.user?.id
    });

    res.status(201).json({ success: true, data: setup });
  } catch (error) {
    console.error("Error creating loan setup:", error);
    res.status(500).json({ success: false, message: "Error creating loan setup", error: error.message });
  }
};

exports.getAllLoanSetups = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.user?.facilityId;
    const setups = await db.loan_setups.findAll({
      where: { facilityId, status: true },
      order: [["name", "ASC"]]
    });
    res.json({ success: true, data: setups });
  } catch (error) {
    console.error("Error fetching loan setups:", error);
    res.status(500).json({ success: false, message: "Error fetching loan setups", error: error.message });
  }
};

exports.updateLoanSetup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, amount, receivableHead, facilityId, userId } = req.body;
    
    const setup = await db.loan_setups.findOne({
      where: { id, facilityId: facilityId || req.user?.facilityId }
    });

    if (!setup) return res.status(404).json({ success: false, message: "Setup not found" });

    setup.name = name || setup.name;
    setup.description = description || setup.description;
    setup.amount = amount !== undefined ? amount : setup.amount;
    setup.receivableHead = receivableHead || setup.receivableHead;
    setup.updatedBy = userId || req.user?.id;

    await setup.save();
    res.json({ success: true, data: setup });
  } catch (error) {
    console.error("Error updating loan setup:", error);
    res.status(500).json({ success: false, message: "Error updating loan setup", error: error.message });
  }
};

// ==========================================
// LOAN MANAGEMENT
// ==========================================

exports.getNextLoanReference = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.user?.facilityId;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    const reference = await peekNextLoanReference(facilityId);
    return res.json({ success: true, data: { reference } });
  } catch (error) {
    console.error("Error peeking loan reference:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get next loan reference",
      error: error.message,
    });
  }
};

exports.createLoan = async (req, res) => {
  try {
    const {
      employeeId,
      amount,
      purpose,
      repaymentMethod,
      durationMonths,
      monthlyDeductionAmount,
      facilityId,
      userId,
      receivableHead,
      loanSetupId,
      paymentMode,
      bankHead,
      cashHead,
      reference,
      chequeNumber,
      postDisbursement = true,
      startMonth,
      startDate,
    } = req.body;

    if (!employeeId || !amount || !durationMonths) {
      return res.status(400).json({
        success: false,
        message: "Missing required loan fields",
      });
    }

    const loanStartDate = parseLoanStartDate(startMonth, startDate);
    const isSelfRepayment = repaymentMethod === "Self";
    if (!isSelfRepayment && !loanStartDate) {
      return res.status(400).json({
        success: false,
        message: "Select the month when the loan starts applying",
      });
    }
    const resolvedStartDate =
      loanStartDate ||
      (() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
      })();

    const resolvedFacilityId = facilityId || req.user?.facilityId;
    const resolvedUserId = userId || req.user?.id;

    let setupReceivable = receivableHead || null;
    if (!setupReceivable && loanSetupId) {
      const setup = await db.loan_setups.findOne({
        where: { id: loanSetupId, facilityId: resolvedFacilityId },
      });
      setupReceivable = setup?.receivableHead || null;
    }

    if (!setupReceivable) {
      return res.status(400).json({
        success: false,
        message:
          "Loan receivable account is missing. Select a receivable account when creating the loan.",
      });
    }

    const mode = ["bank", "cheque", "cash"].includes(paymentMode)
      ? paymentMode
      : "bank";
    const resolvedBankHead = mode === "cash" ? null : bankHead || null;
    const resolvedCashHead = mode === "cash" ? cashHead || null : null;
    const disbursementHead =
      mode === "cash" ? resolvedCashHead : resolvedBankHead;
    const resolvedCheque =
      mode === "cheque" ? String(chequeNumber || "").trim() : null;

    if (!disbursementHead) {
      return res.status(400).json({
        success: false,
        message:
          mode === "cash"
            ? "Select the cash account to pay the loan from"
            : "Select the bank account to pay the loan from",
      });
    }

    if (mode === "cheque" && !resolvedCheque) {
      return res.status(400).json({
        success: false,
        message: "Cheque number is required for cheque disbursements",
      });
    }

    const employee = await db.employees.findOne({
      where: { id: employeeId, facilityId: resolvedFacilityId },
    });
    const empName = employee
      ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim()
      : "Staff";

    const loanId = uuidv4();
    const loanAmount = parseFloat(amount);
    const months = parseInt(durationMonths, 10);
    const shouldPost = postDisbursement !== false && postDisbursement !== "false";

    // Always allocate a number-generator reference for the loan voucher
    const loanReference = await allocateLoanReference(resolvedFacilityId);

    if (shouldPost) {
      await recordGLTransaction({
        facilityId: resolvedFacilityId,
        accountDR: setupReceivable,
        accountCR: disbursementHead,
        amount: loanAmount,
        description: `Loan Disbursement (${mode.toUpperCase()})${
          resolvedCheque ? ` - Chq: ${resolvedCheque}` : ""
        } - ${empName}`,
        reference: loanReference,
        createdBy: resolvedUserId,
        transactionRef: loanId,
      });
    }

    const newLoan = await db.loans.create({
      id: loanId,
      employeeId,
      loanSetupId,
      facilityId: resolvedFacilityId,
      amount: loanAmount,
      purpose: purpose || `Staff loan - ${empName}`,
      repaymentMethod: repaymentMethod || "Salary Deduction",
      durationMonths: months,
      monthlyDeductionAmount:
        monthlyDeductionAmount || loanAmount / months,
      createdBy: resolvedUserId,
      status: shouldPost ? "Approved" : "Pending",
      startDate: resolvedStartDate,
      receivableHead: setupReceivable,
      paymentMode: mode,
      bankHead: resolvedBankHead,
      cashHead: resolvedCashHead,
      chequeNumber: resolvedCheque,
      referenceNumber: loanReference,
    });

    res.status(201).json({
      success: true,
      message: shouldPost
        ? `Loan disbursed and posted (${loanReference})`
        : `Loan request created (${loanReference})`,
      data: newLoan,
    });
  } catch (error) {
    console.error("Error creating loan:", error);
    res.status(500).json({
      success: false,
      message: "Error creating loan request",
      error: error.message,
    });
  }
};

exports.getAllLoans = async (req, res) => {
  try {
    const facilityId = req.query.facilityId || req.user?.facilityId;
    
    const loans = await db.loans.findAll({
      where: { facilityId },
      include: [
        {
          model: db.employees,
          as: "employee",
          attributes: ["id", "firstName", "lastName", "employeeId", "departmentId"],
          include: [
            {
              model: db.Department,
              as: "department",
              attributes: ["departmentName"]
            }
          ]
        },
        {
          model: db.loan_setups,
          as: "setup"
        }
      ],
      order: [["createdAt", "DESC"]]
    });

    // Prefer the General Ledger voucher reference when available
    const loanIds = loans.map((l) => l.id).filter(Boolean);
    let glRefByLoanId = {};
    if (loanIds.length) {
      const glRows = await db.sequelize.query(
        `SELECT transaction_ref, reference_number
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND transaction_ref IN (:loanIds)
           AND reference_number IS NOT NULL
           AND reference_number <> ''
         GROUP BY transaction_ref, reference_number`,
        {
          replacements: { facilityId, loanIds },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      glRefByLoanId = Object.fromEntries(
        (glRows || []).map((r) => [r.transaction_ref, r.reference_number]),
      );
    }

    const data = loans.map((loan) => {
      const plain = loan.toJSON ? loan.toJSON() : loan;
      const glRef = glRefByLoanId[plain.id];
      return {
        ...plain,
        referenceNumber: glRef || plain.referenceNumber || null,
      };
    });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching loans",
      error: error.message
    });
  }
};

exports.updateLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount,
      purpose,
      repaymentMethod,
      durationMonths,
      userId,
      facilityId,
      paymentMode,
      bankHead,
      cashHead,
      receivableHead,
      loanSetupId,
      startMonth,
      startDate,
    } = req.body;

    const loan = await db.loans.findOne({
      where: { id, facilityId: facilityId || req.user?.facilityId }
    });

    if (!loan) return res.status(404).json({ success: false, message: "Loan not found" });

    if (["Paid Off", "Rejected"].includes(loan.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot edit a closed loan",
      });
    }

    const hasFullEditFields =
      amount !== undefined ||
      purpose !== undefined ||
      paymentMode !== undefined ||
      bankHead !== undefined ||
      cashHead !== undefined ||
      receivableHead !== undefined ||
      loanSetupId !== undefined;

    // Active loans may only change repayment schedule fields
    if (loan.status !== "Pending" && hasFullEditFields) {
      return res.status(400).json({
        success: false,
        message: "Only pending loans can be fully edited",
      });
    }

    if (repaymentMethod !== undefined) {
      if (!["Self", "Salary Deduction"].includes(repaymentMethod)) {
        return res.status(400).json({
          success: false,
          message: "Invalid repayment method",
        });
      }
      loan.repaymentMethod = repaymentMethod;
    }

    if (durationMonths !== undefined) {
      const months = parseInt(durationMonths, 10);
      if (!Number.isFinite(months) || months < 1) {
        return res.status(400).json({
          success: false,
          message: "Duration must be at least 1 month",
        });
      }
      loan.durationMonths = months;

      // Recalculate monthly deduction from remaining balance
      const outstanding =
        parseFloat(loan.amount) - parseFloat(loan.amountPaid || 0);
      loan.monthlyDeductionAmount =
        outstanding > 0 ? outstanding / months : 0;
    }

    if (startMonth !== undefined || startDate !== undefined) {
      // Self repayment does not use salary deduction start month
      if (loan.repaymentMethod === "Self" && !startMonth && !startDate) {
        // no-op: leave existing startDate
      } else {
        const parsed = parseLoanStartDate(startMonth, startDate);
        if (!parsed && loan.repaymentMethod !== "Self") {
          return res.status(400).json({
            success: false,
            message: "Invalid start month for loan deductions",
          });
        }
        if (parsed) loan.startDate = parsed;
      }
    }

    if (loan.status === "Pending") {
      loan.amount = amount !== undefined ? amount : loan.amount;
      loan.purpose = purpose || loan.purpose;
      if (receivableHead !== undefined) loan.receivableHead = receivableHead;
      if (loanSetupId !== undefined) loan.loanSetupId = loanSetupId;

      // If duration wasn't sent but amount changed on pending, refresh monthly
      if (durationMonths === undefined && amount !== undefined) {
        const months = parseInt(loan.durationMonths, 10) || 1;
        loan.monthlyDeductionAmount = parseFloat(loan.amount) / months;
      }

      if (paymentMode !== undefined) {
        const mode = ["bank", "cheque", "cash"].includes(paymentMode)
          ? paymentMode
          : loan.paymentMode || "bank";
        loan.paymentMode = mode;
        if (mode === "cash") {
          if (!cashHead) {
            return res.status(400).json({
              success: false,
              message: "Select the cash account to pay the loan from",
            });
          }
          loan.cashHead = cashHead;
          loan.bankHead = null;
        } else {
          if (!bankHead) {
            return res.status(400).json({
              success: false,
              message: "Select the bank account to pay the loan from",
            });
          }
          loan.bankHead = bankHead;
          loan.cashHead = null;
        }
      }
    }

    loan.updatedBy = userId || req.user?.id;

    await loan.save();
    res.json({ success: true, data: loan });
  } catch (error) {
    console.error("Error updating loan:", error);
    res.status(500).json({ success: false, message: "Error updating loan", error: error.message });
  }
};

exports.updateLoanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      remarks,
      startDate,
      startMonth,
      userId,
      facilityId,
      paymentMode,
      bankHead,
      cashHead,
      reference,
      chequeNumber,
    } = req.body;
    
    const loan = await db.loans.findOne({
      where: { id, facilityId: facilityId || req.user?.facilityId },
      include: [
        { model: db.employees, as: "employee" },
        { model: db.loan_setups, as: "setup" }
      ]
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    const currentReceivableHead = loan.receivableHead || loan.setup?.receivableHead;

    // Accounting Treatment for Approval (Disbursement)
    if (status === "Approved" && loan.status === "Pending") {
      const mode = paymentMode || loan.paymentMode || "bank";
      const disbursementHead =
        mode === "cash"
          ? cashHead || loan.cashHead
          : bankHead || loan.bankHead;
      
      if (!disbursementHead || !currentReceivableHead) {
        return res.status(400).json({
          success: false,
          message: "Disbursement requires both a Payment Source and a Loan Receivable Account"
        });
      }

      // Record GL Disbursement using number-generator reference
      const empName = `${loan.employee?.firstName || ""} ${loan.employee?.lastName || ""}`.trim();
      const loanReference =
        loan.referenceNumber ||
        (await allocateLoanReference(loan.facilityId));

      await recordGLTransaction({
        facilityId: loan.facilityId,
        accountDR: currentReceivableHead,
        accountCR: disbursementHead,
        amount: loan.amount,
        description: `Loan Disbursement (${mode?.toUpperCase()})${chequeNumber ? ' - Chq: ' + chequeNumber : ''} - ${empName}`,
        reference: loanReference,
        createdBy: userId || req.user?.id,
        transactionRef: loan.id
      });

      // Keep final disbursement source on the loan
      loan.paymentMode = mode;
      loan.referenceNumber = loanReference;
      if (mode === "cash") {
        loan.cashHead = disbursementHead;
        loan.bankHead = null;
      } else {
        loan.bankHead = disbursementHead;
        loan.cashHead = null;
      }
      if (chequeNumber) loan.chequeNumber = chequeNumber;
    }

    loan.status = status;
    loan.updatedBy = userId || req.user?.id;
    const parsedStart = parseLoanStartDate(startMonth, startDate);
    if (parsedStart) {
      loan.startDate = parsedStart;
    } else if (status === "Approved" && !loan.startDate) {
      // Fallback for legacy pending loans with no start month set
      loan.startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }

    await loan.save();

    res.json({
      success: true,
      message: `Loan status updated to ${status}`,
      data: loan
    });
  } catch (error) {
    console.error("Error updating loan status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating loan status",
      error: error.message
    });
  }
};

exports.getEmployeeLoans = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const facilityId = req.query.facilityId || req.user?.facilityId;

    const loans = await db.loans.findAll({
      where: { employeeId, facilityId },
      order: [["createdAt", "DESC"]]
    });

    res.json({
      success: true,
      data: loans
    });
  } catch (error) {
    console.error("Error fetching employee loans:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee loans",
      error: error.message
    });
  }
};

exports.recordRepayment = async (req, res) => {
  try {
    const { id } = req.params; // loanId
    const { amount, paymentMethod, reference, userId, facilityId, paymentMode, bankHead, cashHead, chequeNumber } = req.body;
    
    const loan = await db.loans.findOne({
      where: { id, facilityId: facilityId || req.user?.facilityId },
      include: [
        { model: db.employees, as: "employee" },
        { model: db.loan_setups, as: "setup" }
      ]
    });

    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found" });
    }

    if (loan.status === "Paid Off") {
      return res.status(400).json({ success: false, message: "Loan is already paid off" });
    }

    const repaymentAmount = parseFloat(amount);
    if (!Number.isFinite(repaymentAmount) || repaymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid repayment amount",
      });
    }

    const outstanding =
      parseFloat(loan.amount) - parseFloat(loan.amountPaid || 0);
    if (repaymentAmount > outstanding + 0.0001) {
      return res.status(400).json({
        success: false,
        message: `Amount cannot exceed outstanding balance (${outstanding.toFixed(2)})`,
      });
    }

    const currentReceivableHead = loan.receivableHead || loan.setup?.receivableHead;

    // Use the loan voucher reference (LM-#) for repayments + GL
    let loanReference = loan.referenceNumber || null;
    if (!loanReference) {
      loanReference = await allocateLoanReference(loan.facilityId);
      loan.referenceNumber = loanReference;
    }

    // Create the repayment record first so we can link GL to it
    const repaymentId = uuidv4();
    const repayment = await db.loan_repayments.create({
      id: repaymentId,
      loanId: loan.id,
      facilityId: loan.facilityId,
      amount: repaymentAmount,
      paymentMethod: paymentMethod || "Manual",
      reference: loanReference,
      createdBy: userId || req.user?.id || userId,
    });

    // Accounting Treatment for Repayment
    const collectionHead = paymentMode === "cash" ? cashHead : bankHead;
    if (!collectionHead || !currentReceivableHead) {
      // Roll back repayment if we can't post GL
      await repayment.destroy();
      return res.status(400).json({
        success: false,
        message:
          "Repayment requires a collection account (bank/cash) and a loan receivable account",
      });
    }

    const empName = `${loan.employee?.firstName || ""} ${loan.employee?.lastName || ""}`.trim();
    await recordGLTransaction({
      facilityId: loan.facilityId,
      accountDR: collectionHead,
      accountCR: currentReceivableHead,
      amount: repaymentAmount,
      description: `Loan Repayment (${paymentMethod || "Manual"} - ${
        paymentMode?.toUpperCase() || "BANK"
      })${chequeNumber ? " - Chq: " + chequeNumber : ""} - ${empName}`,
      reference: loanReference,
      createdBy: userId || req.user?.id,
      transactionRef: repaymentId,
    });

    // Update loan total paid amount
    const newAmountPaid = parseFloat(loan.amountPaid || 0) + repaymentAmount;
    loan.amountPaid = newAmountPaid;

    if (newAmountPaid >= parseFloat(loan.amount)) {
      loan.status = "Paid Off";
    } else if (loan.status === "Approved") {
      loan.status = "Repaying";
    }

    await loan.save();

    res.status(201).json({
      success: true,
      message: "Repayment recorded successfully",
      data: repayment,
    });
  } catch (error) {
    console.error("Error recording repayment:", error);
    res.status(500).json({ success: false, message: "Error recording repayment", error: error.message });
  }
};

exports.getLoanWithRepayments = async (req, res) => {
  try {
    const { id } = req.params;
    const facilityId = req.query.facilityId || req.user?.facilityId;

    const loan = await db.loans.findOne({
      where: { id, facilityId },
      include: [
        {
          model: db.employees,
          as: "employee",
          attributes: ["id", "firstName", "lastName", "employeeId"]
        },
        {
          model: db.loan_repayments,
          as: "repayments",
        },
        {
          model: db.loan_setups,
          as: "setup"
        }
      ],
      order: [
        [{ model: db.loan_repayments, as: 'repayments' }, 'createdAt', 'DESC']
      ]
    });

    if (!loan) return res.status(404).json({ success: false, message: "Loan not found" });

    res.json({ success: true, data: loan });
  } catch (error) {
    console.error("Error fetching loan details:", error);
    res.status(500).json({ success: false, message: "Error fetching loan details", error: error.message });
  }
};

const { Op } = require("sequelize");
const db = require("../models");
const {
  validatePostingDate,
  PostingDateValidationError,
} = require("./validatePostingDate");

/**
 * Validation utilities for journal entries using GeneralLedger
 */

class JournalValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "JournalValidationError";
    this.field = field;
  }
}

/**
 * Check if journal entry is balanced (debits = credits)
 */
function validateBalance(lines) {
  let totalDebit = 0;
  let totalCredit = 0;

  lines.forEach((line) => {
    const debit = parseFloat(line.debit) || 0;
    const credit = parseFloat(line.credit) || 0;

    totalDebit += debit;
    totalCredit += credit;
  });

  // Round to 2 decimal places to avoid floating point issues
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;

  if (totalDebit !== totalCredit) {
    throw new JournalValidationError(
      `Journal entry is not balanced. Debits: ${totalDebit}, Credits: ${totalCredit}`,
      "balance"
    );
  }

  return { totalDebit, totalCredit };
}

/**
 * Validate that each line has only debit OR credit (not both)
 */
function validateLineEntries(lines) {
  if (!lines || lines.length === 0) {
    throw new JournalValidationError("Journal entry must have at least one line", "lines");
  }

  lines.forEach((line, index) => {
    const debit = parseFloat(line.debit) || 0;
    const credit = parseFloat(line.credit) || 0;

    // Both debit and credit should not be present
    if (debit > 0 && credit > 0) {
      throw new JournalValidationError(
        `Line ${index + 1}: Cannot have both debit and credit amounts`,
        `lines[${index}]`
      );
    }

    // At least one should be present and >= 0.01
    if (debit === 0 && credit === 0) {
      throw new JournalValidationError(
        `Line ${index + 1}: Either debit or credit must be greater than 0`,
        `lines[${index}]`
      );
    }

    // Minimum amount validation
    if ((debit > 0 && debit < 0.01) || (credit > 0 && credit < 0.01)) {
      throw new JournalValidationError(
        `Line ${index + 1}: Amount must be at least 0.01`,
        `lines[${index}]`
      );
    }

    // Validate account code
    if (!line.account_code || line.account_code.trim() === "") {
      throw new JournalValidationError(
        `Line ${index + 1}: Account code is required`,
        `lines[${index}].account_code`
      );
    }
  });
}

/**
 * Check if reference number is unique
 */
async function validateReferenceUnique(referenceNumber, facilityId, excludeRef = null) {
  const whereClause = {
    reference_number: referenceNumber,
    facility_id: facilityId,
    type: "inventory", // Journal entries use inventory type
  };

  if (excludeRef) {
    whereClause.transaction_ref = { [Op.ne]: excludeRef };
  }

  const existing = await db.GeneralLedger.findOne({
    where: whereClause,
  });

  if (existing) {
    throw new JournalValidationError(
      `Reference number '${referenceNumber}' already exists`,
      "reference_number"
    );
  }
}

/**
 * Check posting date is within allowed range (2025-01-01 … today).
 */
async function validateDateNotLocked(entryDate, facilityId) {
  void facilityId;
  validatePostingDate(entryDate, { field: "entry_date" });
}

/**
 * Validate that posted entries cannot be modified
 */
function validateNotPosted(status) {
  if (status === "posted") {
    throw new JournalValidationError(
      "Posted journal entries cannot be modified",
      "status"
    );
  }

  if (status === "reversed") {
    throw new JournalValidationError(
      "Reversed journal entries cannot be modified",
      "status"
    );
  }
}

/**
 * Calculate base amounts (for multi-currency support)
 */
function calculateBaseAmounts(lines, baseCurrency = "NGN") {
  return lines.map((line) => {
    const debit = parseFloat(line.debit) || 0;
    const credit = parseFloat(line.credit) || 0;
    const exchangeRate = parseFloat(line.exchange_rate) || 1.0;
    const currency = line.currency || baseCurrency;

    // Calculate base currency amounts
    const base_debit = currency !== baseCurrency ? debit * exchangeRate : debit;
    const base_credit = currency !== baseCurrency ? credit * exchangeRate : credit;

    return {
      ...line,
      currency,
      exchange_rate: exchangeRate,
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      base_debit: Math.round(base_debit * 100) / 100,
      base_credit: Math.round(base_credit * 100) / 100,
    };
  });
}

/**
 * Validate permissions
 */
function validatePermissions(user, action) {
  const permissions = {
    admin: ["create", "edit", "post", "reverse", "delete", "view", "export"],
    accountant: ["create", "edit", "post", "reverse", "delete", "view", "export"],
    "store owner": ["create", "edit", "post", "reverse", "delete", "view", "export"],
    reader: ["view", "export"],
  };

  // Normalize role to lowercase and trim whitespace
  const userRole = (user.role || "reader").toLowerCase().trim();
  const allowedActions = permissions[userRole] || permissions.reader;

  if (!allowedActions.includes(action)) {
    throw new JournalValidationError(
      `Permission denied: ${userRole} cannot ${action} journal entries. Allowed roles: admin, accountant, store owner`,
      "permissions"
    );
  }
}

/**
 * Complete validation for creating/updating journal entry
 */
async function validateJournalEntry(data, facilityId, userId, isUpdate = false, excludeRef = null) {
  const errors = [];

  try {
    // Validate required fields
    if (!data.reference_number) {
      errors.push({ field: "reference_number", message: "Reference number is required" });
    }

    if (!data.entry_date) {
      errors.push({ field: "entry_date", message: "Entry date is required" });
    }

    if (!data.lines || !Array.isArray(data.lines) || data.lines.length === 0) {
      errors.push({ field: "lines", message: "At least one line entry is required" });
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Validate line entries
    try {
      validateLineEntries(data.lines);
    } catch (error) {
      errors.push({ field: error.field, message: error.message });
    }

    // Validate each line date (and optional header entry_date)
    data.lines.forEach((line, index) => {
      const lineDate = line.line_date || data.entry_date;
      if (!lineDate) {
        errors.push({
          field: `lines[${index}].line_date`,
          message: `Line ${index + 1}: date is required`,
        });
        return;
      }
      try {
        validatePostingDate(lineDate, { field: `lines[${index}].line_date` });
      } catch (error) {
        errors.push({
          field: error.field || `lines[${index}].line_date`,
          message: error.message,
        });
      }
    });

    if (data.entry_date) {
      try {
        validatePostingDate(data.entry_date, { field: "entry_date" });
      } catch (error) {
        errors.push({ field: error.field || "entry_date", message: error.message });
      }
    }

    // Validate balance
    try {
      const { totalDebit, totalCredit } = validateBalance(data.lines);
      data.total_debit = totalDebit;
      data.total_credit = totalCredit;
    } catch (error) {
      errors.push({ field: error.field, message: error.message });
    }

    // Validate reference uniqueness
    try {
      await validateReferenceUnique(data.reference_number, facilityId, excludeRef);
    } catch (error) {
      errors.push({ field: error.field, message: error.message });
    }

    // Validate date not locked
    try {
      await validateDateNotLocked(data.entry_date, facilityId);
    } catch (error) {
      errors.push({ field: error.field, message: error.message });
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, data };
  } catch (error) {
    return {
      valid: false,
      errors: [{ field: "general", message: error.message }],
    };
  }
}

module.exports = {
  JournalValidationError,
  validateBalance,
  validateLineEntries,
  validateReferenceUnique,
  validateDateNotLocked,
  validateNotPosted,
  calculateBaseAmounts,
  validatePermissions,
  validateJournalEntry,
  PostingDateValidationError,
};

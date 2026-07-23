const JournalEntryService = require("../services/journalEntryService");
const {
  JournalValidationError,
} = require("../utils/journalValidation");
const { PostingDateValidationError } = require("../utils/validatePostingDate");
const { Parser } = require("json2csv");
const db = require("../models");

/**
 * Controller for Journal Entry API endpoints
 * Uses GeneralLedger table directly
 */

/**
 * Create a new journal entry
 * POST /api/journals
 */
exports.createJournalEntry = async (req, res) => {
  try {
    const { facility_id, user_id, user_role } = req.body;

    console.log("Create Journal Entry - Received data:", {
      facility_id,
      user_id,
      user_role,
      user_role_type: typeof user_role,
    });

    // Permission check removed - all authenticated users can create journal entries

    const journalEntry = await JournalEntryService.createJournalEntry(
      req.body,
      facility_id,
      user_id
    );

    return res.status(201).json({
      success: true,
      message: "Journal entry created successfully",
      data: journalEntry,
    });
  } catch (error) {
    console.error("Error creating journal entry:", error);

    if (error instanceof JournalValidationError) {
      return res.status(400).json({
        success: false,
        message: error.message,
        errors: error.field,
      });
    }

    if (error instanceof PostingDateValidationError) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create journal entry",
      error: error.message,
    });
  }
};

/**
 * Get all journal entries with filters
 * POST /api/journals/list - Changed to POST to send facility_id in body
 */
exports.getJournalEntries = async (req, res) => {
  try {
    const {
      facility_id,
      user_role,
      status,
      start_date,
      end_date,
      account_code,
      reference,
      page,
      limit,
      sort_by,
      sort_order,
    } = req.body;

    console.log("Get journal entries request:", { facility_id, user_role });

    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id is required",
      });
    }

    // Permission check removed - all authenticated users can view journal entries

    const filters = {
      status,
      startDate: start_date,
      endDate: end_date,
      accountCode: account_code,
      referenceNumber: reference,
      page: page || 1,
      limit: limit || 50,
      sortBy: sort_by || "transaction_date",
      sortOrder: sort_order || "DESC",
    };

    const result = await JournalEntryService.getJournalEntries(
      facility_id,
      filters
    );

    console.log(
      `Returning ${result.entries.length} journal entries to frontend`
    );

    return res.status(200).json({
      success: true,
      data: result.entries,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Error fetching journal entries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch journal entries",
      error: error.message,
    });
  }
};

/**
 * Get journal entry by transaction reference
 * GET /api/journals/:transaction_ref
 */
exports.getJournalEntryByRef = async (req, res) => {
  try {
    const { transaction_ref } = req.params;
    const { facility_id, user_role } = req.query;

    // Permission check removed - all authenticated users can view journal entries

    const journalEntry = await JournalEntryService.getJournalEntryByRef(
      transaction_ref,
      facility_id
    );

    return res.status(200).json({
      success: true,
      data: journalEntry,
    });
  } catch (error) {
    console.error("Error fetching journal entry:", error);

    if (error.message === "Journal entry not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to fetch journal entry",
      error: error.message,
    });
  }
};

/**
 * Update journal entry
 * PUT /api/journals/:transaction_ref
 */
exports.updateJournalEntry = async (req, res) => {
  try {
    const { transaction_ref } = req.params;
    const { facility_id, user_id, user_role } = req.body;

    // Permission check removed - all authenticated users can edit journal entries

    const journalEntry = await JournalEntryService.updateJournalEntry(
      transaction_ref,
      req.body,
      facility_id,
      user_id
    );

    return res.status(200).json({
      success: true,
      message: "Journal entry updated successfully",
      data: journalEntry,
    });
  } catch (error) {
    console.error("Error updating journal entry:", error);

    if (error instanceof JournalValidationError) {
      return res.status(400).json({
        success: false,
        message: error.message,
        errors: error.field,
      });
    }

    if (error.message === "Journal entry not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update journal entry",
      error: error.message,
    });
  }
};

/**
 * Post (approve) journal entry
 * POST /api/journals/:transaction_ref/post
 */
exports.postJournalEntry = async (req, res) => {
  try {
    const { transaction_ref } = req.params;
    const { facility_id, user_id, user_role } = req.body;

    // Permission check removed - all authenticated users can post journal entries

    const journalEntry = await JournalEntryService.postJournalEntry(
      transaction_ref,
      facility_id,
      user_id
    );

    return res.status(200).json({
      success: true,
      message: "Journal entry posted successfully",
      data: journalEntry,
    });
  } catch (error) {
    console.error("Error posting journal entry:", error);

    if (error.message === "Journal entry not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to post journal entry",
      error: error.message,
    });
  }
};

/**
 * Reverse journal entry
 * POST /api/journals/:transaction_ref/reverse
 */
exports.reverseJournalEntry = async (req, res) => {
  try {
    const { transaction_ref } = req.params;
    const { facility_id, user_id, user_role, reversal_date } = req.body;

    // Permission check removed - all authenticated users can reverse journal entries

    const reversalEntry = await JournalEntryService.reverseJournalEntry(
      transaction_ref,
      facility_id,
      user_id,
      reversal_date
    );

    return res.status(200).json({
      success: true,
      message: "Journal entry reversed successfully",
      data: reversalEntry,
    });
  } catch (error) {
    console.error("Error reversing journal entry:", error);

    if (error.message === "Journal entry not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to reverse journal entry",
      error: error.message,
    });
  }
};

/**
 * Delete journal entry (only drafts)
 * DELETE /api/journals/:transaction_ref
 */
exports.deleteJournalEntry = async (req, res) => {
  try {
    const { transaction_ref } = req.params;
    const { facility_id, user_role } = req.query;

    // Permission check removed - all authenticated users can delete journal entries

    const result = await JournalEntryService.deleteJournalEntry(
      transaction_ref,
      facility_id
    );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Error deleting journal entry:", error);

    if (error.message === "Journal entry not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to delete journal entry",
      error: error.message,
    });
  }
};

/**
 * Export journal entry to CSV
 * GET /api/journals/:transaction_ref/export?format=csv
 */
exports.exportJournalEntry = async (req, res) => {
  try {
    const { transaction_ref } = req.params;
    const { facility_id, user_role, format = "csv" } = req.query;

    // Permission check removed - all authenticated users can export journal entries

    const journalEntry = await JournalEntryService.getJournalEntryByRef(
      transaction_ref,
      facility_id
    );

    if (format === "csv") {
      const csvData = journalEntry.lines.map((line) => ({
        "Reference Number": journalEntry.reference_number,
        "Entry Date": journalEntry.entry_date,
        Description: journalEntry.description,
        "Line Number": line.line_number,
        "Account Code": line.account_code,
        "Account Name": line.account_name,
        "Line Description": line.description,
        Debit: line.debit,
        Credit: line.credit,
        Status: journalEntry.status === "saved" ? "draft" : journalEntry.status,
      }));

      const parser = new Parser();
      const csv = parser.parse(csvData);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=journal_entry_${journalEntry.reference_number}.csv`
      );

      return res.status(200).send(csv);
    }

    return res.status(400).json({
      success: false,
      message: "Unsupported export format",
    });
  } catch (error) {
    console.error("Error exporting journal entry:", error);

    if (error.message === "Journal entry not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to export journal entry",
      error: error.message,
    });
  }
};

/**
 * Debug endpoint to check journal entries in database
 * GET /api/journals/debug/:facilityId
 */
exports.debugJournalEntries = async (req, res) => {
  try {
    const { facilityId } = req.params;

    const [allInventoryEntries] = await db.sequelize.query(
      `SELECT transaction_ref, reference_number, transaction_date, status, type, dr, cr
       FROM general_ledger
       WHERE facility_id = :facilityId
         AND type = 'inventory'
       ORDER BY created_at DESC
       LIMIT 20`,
      {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Debug data",
      data: allInventoryEntries,
      count: allInventoryEntries.length,
    });
  } catch (error) {
    console.error("Debug error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get customers and suppliers for journal entry
 * GET /api/journals/customers-suppliers/:facilityId
 */
exports.getCustomersAndSuppliers = async (req, res) => {
  try {
    const { facilityId } = req.params;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    // Execute UNION query to get customers and suppliers
    const results = await db.sequelize.query(
      `SELECT
        customerNo AS No,
        fullname AS name,
        address,
        email,
        'Customer' AS type
      FROM customers
      WHERE facilityId = :facilityId
      UNION
      SELECT
        supplier_number AS No,
        supplier_name AS name,
        address,
        email,
        'Supplier' AS type
      FROM suppliersinfo
      WHERE facilityId = :facilityId
      ORDER BY type, name`,
      {
        replacements: { facilityId },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );
    console.log("Customers and suppliers results:", results);
    return res.status(200).json({
      success: true,
      data: results,
      count: results.length,
    });
  } catch (error) {
    console.error("Error fetching customers and suppliers:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers and suppliers",
      error: error.message,
    });
  }
};

/**
 * Export multiple journal entries to CSV
 * POST /api/journals/export - Changed to POST
 */
exports.exportJournalEntries = async (req, res) => {
  try {
    const {
      facility_id,
      user_role,
      format = "csv",
      status,
      start_date,
      end_date,
      account_code,
      reference,
    } = req.body;

    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id is required",
      });
    }

    // Permission check removed - all authenticated users can export journal entries

    const filters = {
      status,
      startDate: start_date,
      endDate: end_date,
      accountCode: account_code,
      referenceNumber: reference,
      limit: 10000,
    };

    const result = await JournalEntryService.getJournalEntries(
      facility_id,
      filters
    );

    if (format === "csv") {
      const csvData = result.entries.map((entry) => ({
        "Reference Number": entry.reference_number,
        "Entry Date": entry.entry_date,
        Description: entry.description,
        "Total Debit": entry.total_debit,
        "Total Credit": entry.total_credit,
        Status: entry.status === "saved" ? "draft" : entry.status,
        "Created By": entry.created_by,
        "Created At": entry.created_at,
      }));

      const parser = new Parser();
      const csv = parser.parse(csvData);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=journal_entries_export_${Date.now()}.csv`
      );

      return res.status(200).send(csv);
    }

    return res.status(400).json({
      success: false,
      message: "Unsupported export format",
    });
  } catch (error) {
    console.error("Error exporting journal entries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export journal entries",
      error: error.message,
    });
  }
};

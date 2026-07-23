"use strict";

const { Op } = require("sequelize");
const db = require("../models");
const {
  validatePostingDate,
  PostingDateValidationError,
} = require("../utils/validatePostingDate");

function normalizeDateOnly(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseAmount(value) {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sumLedgerSides(ledgerLines) {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of ledgerLines) {
    totalDebit += parseFloat(line.dr || 0);
    totalCredit += parseFloat(line.cr || 0);
  }
  return { totalDebit, totalCredit };
}

function isLedgerBalanced(totalDebit, totalCredit, tolerance = 0.01) {
  return Math.abs(totalDebit - totalCredit) <= tolerance;
}

function balanceErrorMessage(totalDebit, totalCredit) {
  const diff = Math.abs(totalDebit - totalCredit);
  return `Journal entry must remain balanced (debits = credits). After this change: Debit ₦${totalDebit.toFixed(
    2
  )} vs Credit ₦${totalCredit.toFixed(2)} — difference ₦${diff.toFixed(2)}. Adjust or delete offsetting lines first.`;
}

async function syncJournalSummary(transactionRef, facilityId, transaction) {
  const lines = await db.GeneralLedger.findAll({
    where: { transaction_ref: transactionRef, facility_id: facilityId },
    order: [["transaction_id", "ASC"]],
    transaction,
  });

  const ref = String(transactionRef).trim();
  const fid = String(facilityId).trim();

  try {
    if (lines.length === 0) {
      await db.sequelize.query(
        `DELETE FROM journal_entries
         WHERE transaction_ref = :transactionRef AND facility_id = :facilityId`,
        {
          replacements: { transactionRef: ref, facilityId: fid },
          type: db.sequelize.QueryTypes.DELETE,
          transaction,
        }
      );
      return;
    }

    const totalDebit = lines.reduce(
      (sum, line) => sum + parseFloat(line.dr || 0),
      0
    );
    const totalCredit = lines.reduce(
      (sum, line) => sum + parseFloat(line.cr || 0),
      0
    );
    const first = lines[0];

    const existing = await db.sequelize.query(
      `SELECT transaction_ref FROM journal_entries
       WHERE transaction_ref = :transactionRef AND facility_id = :facilityId
       LIMIT 1`,
      {
        replacements: { transactionRef: ref, facilityId: fid },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      }
    );

    if (existing.length > 0) {
      await db.sequelize.query(
        `UPDATE journal_entries
         SET reference_number = :reference_number,
             entry_date = :entry_date,
             description = :description,
             total_debit = :total_debit,
             total_credit = :total_credit,
             status = :status,
             updated_at = NOW()
         WHERE transaction_ref = :transactionRef AND facility_id = :facilityId`,
        {
          replacements: {
            reference_number: first.reference_number || "",
            entry_date: first.transaction_date,
            description:
              first.purpose_of_payment || first.transaction_description || "",
            total_debit: totalDebit,
            total_credit: totalCredit,
            status: first.status || "posted",
            transactionRef: ref,
            facilityId: fid,
          },
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );
    }
  } catch (err) {
    // journal_entries is optional summary — GL lines are source of truth
    console.warn("syncJournalSummary skipped:", err.message);
  }
}

exports.listJournalEntriesForCorrection = async (req, res) => {
  try {
    const { facilityId, q = "", limit = 30 } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const trimmed = String(q || "").trim();
    const where = { facility_id: facilityId };
    if (trimmed) {
      where[Op.or] = [
        { reference_number: { [Op.like]: `%${trimmed}%` } },
        { transaction_ref: { [Op.like]: `%${trimmed}%` } },
        { purpose_of_payment: { [Op.like]: `%${trimmed}%` } },
        { transaction_description: { [Op.like]: `%${trimmed}%` } },
      ];
    }

    const rows = await db.GeneralLedger.findAll({
      attributes: [
        "transaction_ref",
        [db.sequelize.fn("MAX", db.sequelize.col("reference_number")), "reference_number"],
        [db.sequelize.fn("MIN", db.sequelize.col("transaction_date")), "transaction_date"],
        [db.sequelize.fn("SUM", db.sequelize.col("dr")), "total_debit"],
        [db.sequelize.fn("SUM", db.sequelize.col("cr")), "total_credit"],
        [
          db.sequelize.fn("COUNT", db.sequelize.col("transaction_id")),
          "line_count",
        ],
        [
          db.sequelize.fn("MAX", db.sequelize.col("purpose_of_payment")),
          "purpose_of_payment",
        ],
        [db.sequelize.fn("MAX", db.sequelize.col("status")), "status"],
      ],
      where,
      group: ["transaction_ref"],
      order: [[db.sequelize.literal("transaction_date"), "DESC"]],
      limit: Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100),
      raw: true,
    });

    return res.status(200).json({
      success: true,
      results: rows.map((row) => ({
        transaction_ref: row.transaction_ref,
        reference_number: row.reference_number,
        transaction_date: row.transaction_date,
        total_debit: parseFloat(row.total_debit || 0),
        total_credit: parseFloat(row.total_credit || 0),
        line_count: parseInt(row.line_count, 10) || 0,
        purpose_of_payment: row.purpose_of_payment || "",
        status: row.status || "",
      })),
    });
  } catch (error) {
    console.error("listJournalEntriesForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list journal entries for correction",
      error: error.message,
    });
  }
};

exports.getJournalLinesForCorrection = async (req, res) => {
  try {
    const { facilityId, transactionRef } = req.query;
    if (!facilityId || !transactionRef) {
      return res.status(400).json({
        success: false,
        message: "facilityId and transactionRef are required",
      });
    }

    const lines = await db.GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        transaction_ref: String(transactionRef).trim(),
      },
      order: [["transaction_id", "ASC"]],
      raw: true,
    });

    if (!lines.length) {
      return res.status(404).json({
        success: false,
        message: "Journal entry not found",
      });
    }

    return res.status(200).json({
      success: true,
      results: lines,
      summary: {
        transaction_ref: lines[0].transaction_ref,
        reference_number: lines[0].reference_number,
        transaction_date: lines[0].transaction_date,
        purpose_of_payment: lines[0].purpose_of_payment,
        status: lines[0].status,
        total_debit: lines.reduce((s, l) => s + parseFloat(l.dr || 0), 0),
        total_credit: lines.reduce((s, l) => s + parseFloat(l.cr || 0), 0),
      },
    });
  } catch (error) {
    console.error("getJournalLinesForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load journal lines",
      error: error.message,
    });
  }
};

exports.updateJournalLineForCorrection = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      transactionId,
      transactionDate,
      dr,
      cr,
    } = req.body || {};

    if (!facilityId || !transactionId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and transactionId are required",
      });
    }

    const line = await db.GeneralLedger.findOne({
      where: {
        transaction_id: transactionId,
        facility_id: facilityId,
      },
      transaction,
    });

    if (!line) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Ledger line not found",
      });
    }

    const patch = {
      updated_by: req.user?.id || req.body?.updatedBy || null,
    };

    if (transactionDate !== undefined && transactionDate !== null && transactionDate !== "") {
      try {
        patch.transaction_date = validatePostingDate(transactionDate, {
          field: "transactionDate",
        });
      } catch (error) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
    }

    if (dr !== undefined && dr !== null && dr !== "") {
      const parsedDr = parseAmount(dr);
      if (parsedDr === null) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid debit amount",
        });
      }
      patch.dr = parsedDr;
    }

    if (cr !== undefined && cr !== null && cr !== "") {
      const parsedCr = parseAmount(cr);
      if (parsedCr === null) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid credit amount",
        });
      }
      patch.cr = parsedCr;
    }

    await line.update(patch, { transaction });

    const remainingLines = await db.GeneralLedger.findAll({
      where: {
        transaction_ref: line.transaction_ref,
        facility_id: facilityId,
      },
      transaction,
      raw: true,
    });
    const { totalDebit, totalCredit } = sumLedgerSides(remainingLines);
    if (
      remainingLines.length > 0 &&
      !isLedgerBalanced(totalDebit, totalCredit)
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: balanceErrorMessage(totalDebit, totalCredit),
      });
    }

    await syncJournalSummary(line.transaction_ref, facilityId, transaction);
    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Ledger line updated",
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("updateJournalLineForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update ledger line",
      error: error.message,
    });
  }
};

exports.updateJournalDateForCorrection = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, transactionRef, newTransactionDate } = req.body || {};
    if (!facilityId || !transactionRef || !newTransactionDate) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId, transactionRef and newTransactionDate are required",
      });
    }

    let normalizedDate;
    try {
      normalizedDate = validatePostingDate(newTransactionDate, {
        field: "newTransactionDate",
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    const ref = String(transactionRef).trim();
    const lines = await db.GeneralLedger.findAll({
      where: { facility_id: facilityId, transaction_ref: ref },
      transaction,
    });

    if (!lines.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Journal entry not found",
      });
    }

    await db.GeneralLedger.update(
      {
        transaction_date: normalizedDate,
        updated_by: req.user?.id || req.body?.updatedBy || null,
      },
      {
        where: { facility_id: facilityId, transaction_ref: ref },
        transaction,
      }
    );

    await syncJournalSummary(ref, facilityId, transaction);
    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Journal entry date updated",
      updated_count: lines.length,
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("updateJournalDateForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update journal date",
      error: error.message,
    });
  }
};

exports.deleteJournalLineForCorrection = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, transactionId } = req.body || {};
    if (!facilityId || !transactionId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and transactionId are required",
      });
    }

    const line = await db.GeneralLedger.findOne({
      where: {
        transaction_id: transactionId,
        facility_id: facilityId,
      },
      transaction,
    });

    if (!line) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Ledger line not found",
      });
    }

    const transactionRef = line.transaction_ref;
    const lineDr = parseFloat(line.dr || 0);
    const lineCr = parseFloat(line.cr || 0);

    await line.destroy({ transaction });

    const remainingLines = await db.GeneralLedger.findAll({
      where: {
        transaction_ref: transactionRef,
        facility_id: facilityId,
      },
      transaction,
      raw: true,
    });

    const { totalDebit, totalCredit } = sumLedgerSides(remainingLines);
    if (
      remainingLines.length > 0 &&
      !isLedgerBalanced(totalDebit, totalCredit)
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: balanceErrorMessage(totalDebit, totalCredit),
        hint:
          "Delete the matching offset line as well, edit amounts first, or use Delete entire entry.",
        deleted_line: { dr: lineDr, cr: lineCr },
      });
    }

    await syncJournalSummary(transactionRef, facilityId, transaction);
    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Ledger line deleted",
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("deleteJournalLineForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete ledger line",
      error: error.message,
    });
  }
};

exports.deleteJournalEntryForCorrection = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, transactionRef } = req.body || {};
    if (!facilityId || !transactionRef) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and transactionRef are required",
      });
    }

    const ref = String(transactionRef).trim();
    const lines = await db.GeneralLedger.findAll({
      where: { facility_id: facilityId, transaction_ref: ref },
      transaction,
    });

    if (!lines.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Journal entry not found",
      });
    }

    await db.GeneralLedger.destroy({
      where: { facility_id: facilityId, transaction_ref: ref },
      transaction,
    });

    try {
      await db.sequelize.query(
        `DELETE FROM journal_entries
         WHERE transaction_ref = :transactionRef AND facility_id = :facilityId`,
        {
          replacements: { transactionRef: ref, facilityId: String(facilityId).trim() },
          type: db.sequelize.QueryTypes.DELETE,
          transaction,
        }
      );
    } catch (journalErr) {
      console.warn("journal_entries delete skipped:", journalErr.message);
    }

    await db.CustomerEntry.destroy({
      where: { link_id: ref },
      transaction,
    });

    await db.SupplierEntry.destroy({
      where: { link_id: ref },
      transaction,
    });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Journal entry deleted",
      deleted_lines: lines.length,
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("deleteJournalEntryForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete journal entry",
      error: error.message,
    });
  }
};

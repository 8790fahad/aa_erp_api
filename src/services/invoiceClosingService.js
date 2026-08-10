"use strict";

const { Op } = require("sequelize");
const db = require("../models");
const { recordActivity } = require("./activityAuditService");

const UNPAID_NON_CREDIT_STATUSES = [
  "awaiting_payment",
  "awaiting_cashier_confirm",
];

const NON_CREDIT_PAYMENT_TYPES = ["cash", "transfer", "bank", "split"];

function normalizeHistory(history) {
  if (Array.isArray(history)) return history;
  if (typeof history === "string" && history.trim()) {
    try {
      const parsed = JSON.parse(history);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pushHistory(history, status, userId, note) {
  const list = [...normalizeHistory(history)];
  list.push({
    status,
    at: new Date().toISOString(),
    by: userId || "system",
    note: note || null,
  });
  return list;
}

/**
 * Reverse (void) a single unpaid non-credit sale invoice:
 * removes GL / store / customer entries + invoice, cancels sale workflow.
 */
async function voidUnpaidNonCreditSale({
  facilityId,
  saleCode,
  userId = "system",
  reason = "Auto-reversed after daily closing time (unpaid non-credit invoice)",
  transaction: outerTx = null,
} = {}) {
  const ownTx = !outerTx;
  const transaction = outerTx || (await db.sequelize.transaction());

  try {
    const normalizedRef = String(saleCode || "").trim();
    if (!facilityId || !normalizedRef) {
      throw Object.assign(new Error("facilityId and saleCode are required"), {
        status: 400,
      });
    }

    const workflow = await db.SaleWorkflow.findOne({
      where: { facility_id: facilityId, sale_code: normalizedRef },
      transaction,
    });

    if (workflow) {
      const pt = String(workflow.payment_type || "").toLowerCase();
      const st = String(workflow.status || "").toLowerCase();
      if (pt === "credit") {
        throw Object.assign(
          new Error("Credit invoices are not auto-reversed"),
          { status: 400 },
        );
      }
      if (st === "cancelled" || st === "reversed") {
        if (ownTx) await transaction.commit();
        return { skipped: true, sale_code: normalizedRef, reason: "already_cancelled" };
      }
      if (!UNPAID_NON_CREDIT_STATUSES.includes(st)) {
        throw Object.assign(
          new Error(
            `Sale ${normalizedRef} is not in an unpaid non-credit status (${st})`,
          ),
          { status: 400 },
        );
      }
    }

    const invoice = await db.Invoice.findOne({
      where: {
        facility_id: facilityId,
        invoice_ref: normalizedRef,
        type: "sales",
      },
      transaction,
    });

    // Soft void: reverse GL with compensating lines (keep audit trail)
    const ledgerRows = await db.GeneralLedger.findAll({
      where: {
        facility_id: facilityId,
        reference_number: normalizedRef,
      },
      transaction,
    });
    let reversedLedgerCount = 0;
    for (const row of ledgerRows) {
      const plain = row.get ? row.get({ plain: true }) : row;
      const dr = parseFloat(plain.dr || plain.debit || 0);
      const cr = parseFloat(plain.cr || plain.credit || 0);
      if (dr === 0 && cr === 0) continue;
      const clone = { ...plain };
      delete clone.id;
      delete clone.createdAt;
      delete clone.updatedAt;
      delete clone.created_at;
      delete clone.updated_at;
      // Flip debit/credit for reversing entry
      clone.dr = cr;
      clone.cr = dr;
      clone.transaction_description = `VOID: ${plain.transaction_description || normalizedRef}`;
      clone.transaction_ref =
        plain.transaction_ref
          ? `VOID-${plain.transaction_ref}`.slice(0, 100)
          : `VOID-${normalizedRef}`.slice(0, 100);
      await db.GeneralLedger.create(clone, { transaction });
      reversedLedgerCount += 1;
    }

    // Soft reverse stock movements (qty_out → compensating qty_in)
    const storeRows = await db.StoreEntry.findAll({
      where: {
        facilityId,
        reference_number: normalizedRef,
      },
      transaction,
    });
    let reversedStoreEntries = 0;
    for (const row of storeRows) {
      const plain = row.get ? row.get({ plain: true }) : row;
      const qtyOut = parseFloat(plain.qty_out || 0);
      const qtyIn = parseFloat(plain.qty_in || 0);
      if (qtyOut <= 0 && qtyIn <= 0) continue;
      const clone = { ...plain };
      delete clone.id;
      delete clone.createdAt;
      delete clone.updatedAt;
      delete clone.created_at;
      delete clone.updated_at;
      clone.qty_in = qtyOut;
      clone.qty_out = qtyIn;
      clone.type = plain.type || "sales";
      clone.status = "voided";
      clone.destination = "void";
      clone.reference_number = normalizedRef;
      await db.StoreEntry.create(clone, { transaction });
      reversedStoreEntries += 1;
    }

    const deletedCustomerEntries = await db.CustomerEntry.destroy({
      where: {
        facilityId,
        [Op.or]: [{ receiptNo: normalizedRef }, { link_id: normalizedRef }],
      },
      transaction,
    });

    if (invoice) {
      await invoice.update(
        {
          status: "Cancelled",
          balance: 0,
          description: [invoice.description, reason].filter(Boolean).join(" | "),
        },
        { transaction },
      );
    }

    // Soft-cancel: leave fulfillment rows for audit (no hard-delete)

    const deletedLedgerCount = reversedLedgerCount;
    const deletedStoreEntries = reversedStoreEntries;

    const prevStatus = workflow?.status || null;
    const prevPaymentType = workflow?.payment_type || null;
    const prevAmount = workflow?.amount || invoice?.amount || null;

    if (workflow) {
      workflow.status = "cancelled";
      workflow.hold_overnight = true;
      workflow.notes = [workflow.notes, reason].filter(Boolean).join(" | ");
      workflow.history = pushHistory(
        workflow.history,
        "cancelled",
        userId,
        reason,
      );
      workflow.updated_by = userId;
      await workflow.save({ transaction });
    }

    if (ownTx) await transaction.commit();

    await recordActivity({
      facilityId,
      userId,
      action: "delete",
      entityType: "sales_invoice",
      entityId: normalizedRef,
      entityLabel: normalizedRef,
      before: {
        payment_type: prevPaymentType,
        status: prevStatus,
        amount: prevAmount,
      },
      after: { status: "cancelled" },
      remark: reason,
      meta: {
        deleted_ledger_entries: deletedLedgerCount || 0,
        deleted_store_entries: deletedStoreEntries || 0,
        deleted_customer_entries: deletedCustomerEntries || 0,
        auto_close: true,
      },
    });

    return {
      success: true,
      sale_code: normalizedRef,
      deleted_ledger_entries: deletedLedgerCount || 0,
      deleted_store_entries: deletedStoreEntries || 0,
      deleted_customer_entries: deletedCustomerEntries || 0,
      workflow_cancelled: Boolean(workflow),
      invoice_deleted: Boolean(invoice),
    };
  } catch (err) {
    if (ownTx) await transaction.rollback().catch(() => {});
    throw err;
  }
}

/**
 * Find unpaid non-credit sale workflows for a facility and void them.
 */
async function reverseUnpaidNonCreditInvoicesForFacility({
  facilityId,
  userId = "system",
  reason = "Auto-reversed after daily closing time (unpaid non-credit invoice)",
} = {}) {
  const rows = await db.SaleWorkflow.findAll({
    where: {
      facility_id: facilityId,
      payment_type: { [Op.in]: NON_CREDIT_PAYMENT_TYPES },
      status: { [Op.in]: UNPAID_NON_CREDIT_STATUSES },
    },
    order: [["created_at", "ASC"]],
  });

  const results = [];
  for (const row of rows) {
    try {
      const out = await voidUnpaidNonCreditSale({
        facilityId,
        saleCode: row.sale_code,
        userId,
        reason,
      });
      results.push({ sale_code: row.sale_code, ...out });
    } catch (err) {
      results.push({
        sale_code: row.sale_code,
        success: false,
        error: err.message,
      });
    }
  }

  return {
    facilityId,
    candidates: rows.length,
    reversed: results.filter((r) => r.success).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => r.success === false).length,
    results,
  };
}

function parseClosingTime(hhmm) {
  const m = String(hhmm || "17:00").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: 17, minute: 0 };
  const hour = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return { hour, minute };
}

/** Current HH:mm and YYYY-MM-DD in a timezone (fallback: Africa/Lagos). */
function getNowPartsInTimezone(timeZone = "Africa/Lagos", now = new Date()) {
  const tz = timeZone || "Africa/Lagos";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      hour: parseInt(get("hour"), 10) || 0,
      minute: parseInt(get("minute"), 10) || 0,
      timeZone: tz,
    };
  } catch (_) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return {
      date: `${y}-${m}-${d}`,
      hour: now.getHours(),
      minute: now.getMinutes(),
      timeZone: "local",
    };
  }
}

function isPastClosingTime(business, now = new Date()) {
  if (!business?.invoice_closing_enabled) return false;
  const { hour: closeH, minute: closeM } = parseClosingTime(
    business.invoice_closing_time,
  );
  const parts = getNowPartsInTimezone(
    business.invoice_closing_timezone || "Africa/Lagos",
    now,
  );
  const nowMins = parts.hour * 60 + parts.minute;
  const closeMins = closeH * 60 + closeM;
  if (nowMins < closeMins) return false;

  const lastRun = business.invoice_closing_last_run
    ? String(business.invoice_closing_last_run).slice(0, 10)
    : null;
  if (lastRun === parts.date) return false;
  return true;
}

module.exports = {
  voidUnpaidNonCreditSale,
  reverseUnpaidNonCreditInvoicesForFacility,
  isPastClosingTime,
  getNowPartsInTimezone,
  parseClosingTime,
  UNPAID_NON_CREDIT_STATUSES,
  NON_CREDIT_PAYMENT_TYPES,
};

"use strict";

const { Op } = require("sequelize");
const db = require("../models");
const { recordActivity } = require("./activityAuditService");

const UNPAID_NON_CREDIT_STATUSES = [
  "awaiting_payment",
  "awaiting_cashier_confirm",
];

const NON_CREDIT_PAYMENT_TYPES = ["cash", "transfer", "bank", "split"];

function pushHistory(history, status, userId, note) {
  const list = Array.isArray(history) ? [...history] : [];
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

    const deletedLedgerCount = await db.GeneralLedger.destroy({
      where: {
        facility_id: facilityId,
        reference_number: normalizedRef,
      },
      transaction,
    });

    const deletedStoreEntries = await db.StoreEntry.destroy({
      where: {
        facilityId,
        reference_number: normalizedRef,
      },
      transaction,
    });

    const deletedCustomerEntries = await db.CustomerEntry.destroy({
      where: {
        facilityId,
        [Op.or]: [{ receiptNo: normalizedRef }, { link_id: normalizedRef }],
      },
      transaction,
    });

    if (invoice) {
      await db.Invoice.destroy({
        where: {
          facility_id: facilityId,
          invoice_ref: normalizedRef,
        },
        transaction,
      });
    }

    // Clean fulfillments
    if (db.SaleFulfillment) {
      const packs = await db.SaleFulfillment.findAll({
        where: { facility_id: facilityId, sale_code: normalizedRef },
        attributes: ["id"],
        transaction,
      });
      const packIds = packs.map((p) => p.id);
      if (packIds.length && db.SaleFulfillmentLine) {
        await db.SaleFulfillmentLine.destroy({
          where: { fulfillment_id: { [Op.in]: packIds } },
          transaction,
        });
      }
      await db.SaleFulfillment.destroy({
        where: { facility_id: facilityId, sale_code: normalizedRef },
        transaction,
      });
    }

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

"use strict";

const db = require("../models");
const collectionReconciliation = require("../controller/collectionReconciliation");
const { getNowPartsInTimezone } = require("../services/invoiceClosingService");

const MAX_CATCH_UP_DAYS = 14;

function parseTime(value) {
  const match = String(value || "18:00").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: 18, minute: 0 };
  return {
    hour: Math.min(23, Math.max(0, parseInt(match[1], 10))),
    minute: Math.min(59, Math.max(0, parseInt(match[2], 10))),
  };
}

function isPastSaveTime(business, now = new Date()) {
  if (!business?.recon_auto_save_enabled) return false;
  const { hour, minute } = parseTime(business.recon_auto_save_time);
  const parts = getNowPartsInTimezone(
    business.recon_auto_save_timezone || "Africa/Lagos",
    now,
  );
  return parts.hour * 60 + parts.minute >= hour * 60 + minute;
}

/** Add calendar days to a YYYY-MM-DD string. */
function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd)
    .slice(0, 10)
    .split("-")
    .map((n) => parseInt(n, 10));
  if (![y, m, d].every((n) => Number.isFinite(n))) return null;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Dates still owed since last_run.
 * Past missed days are always included. Today only after the save time.
 */
function datesDueForBusiness(business, now = new Date()) {
  if (!business?.recon_auto_save_enabled) return [];
  const parts = getNowPartsInTimezone(
    business.recon_auto_save_timezone || "Africa/Lagos",
    now,
  );
  const today = parts.date;
  const lastRun = business.recon_auto_save_last_run
    ? String(business.recon_auto_save_last_run).slice(0, 10)
    : null;

  if (!lastRun || !/^\d{4}-\d{2}-\d{2}$/.test(lastRun)) {
    return isPastSaveTime(business, now) ? [today] : [];
  }
  if (lastRun >= today) {
    return [];
  }

  const due = [];
  let cursor = addDaysYmd(lastRun, 1);
  let guard = 0;
  while (cursor && cursor <= today && guard < MAX_CATCH_UP_DAYS + 2) {
    guard += 1;
    if (cursor < today) {
      due.push(cursor);
    } else if (cursor === today && isPastSaveTime(business, now)) {
      due.push(cursor);
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return due.slice(0, MAX_CATCH_UP_DAYS);
}

function callJson(handler, req) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode, ...(payload || {}) });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function saveOpenHandIns(business, reconDate) {
  const facilityId = business.id;
  const cash = String(business.recon_cash_account_code || "").trim();
  const safe = String(business.recon_safe_account_code || "").trim();
  const shortage = String(business.recon_shortage_account_code || "").trim();
  const headsReady = Boolean(cash && safe && shortage && cash !== safe);

  const summary = await callJson(collectionReconciliation.getSummary, {
    query: { facilityId, date: reconDate },
  });
  if (!summary?.success) {
    throw new Error(summary?.message || "Could not load open hand-ins");
  }

  const open = (summary.cashiers || []).filter(
    (row) => row.status !== "confirmed" && row.status !== "variance",
  );
  let saved = 0;
  let skipped = 0;
  let blocked = false;

  for (const row of open) {
    const expectedCash = Number(row.expected_cash) || 0;
    const needsCash = expectedCash > 0.05;
    if (needsCash && !headsReady) {
      blocked = true;
      skipped += 1;
      console.error(
        `[recon-auto-save] ${facilityId}: ${row.cashier_name || row.cashier_user_id} skipped — Cash, Safe, and Shortage heads must all be set`,
      );
      continue;
    }

    const result = await callJson(collectionReconciliation.confirmHandIn, {
      body: {
        facilityId,
        date: reconDate,
        cashierUserId: row.cashier_user_id,
        received_cash: expectedCash,
        received_card: Number(row.expected_card) || 0,
        received_transfer: Number(row.expected_transfer) || 0,
        cash_to_safe_amount: expectedCash,
        shortage_amount: 0,
        cash_from_account: needsCash ? cash : null,
        safe_account: needsCash ? safe : null,
        shortage_account: needsCash ? shortage : null,
        confirmed_by_name: "Automatic save",
        note: "Saved automatically",
      },
    });

    if (result?.success || result?.statusCode === 409) {
      saved += 1;
    } else {
      skipped += 1;
      console.error(
        `[recon-auto-save] ${facilityId}: ${row.cashier_name || row.cashier_user_id} — ${result?.message || "failed"}`,
      );
    }
  }

  return { saved, skipped, blocked, open: open.length, date: reconDate };
}

async function runScheduledReconAutoSave() {
  // Scheduled automatic save no longer confirms hand-ins.
  return [];
}

/**
 * One-off / migration helper: save open hand-ins for a specific calendar date
 * for every business that has automatic save enabled (and heads when cash).
 */
async function backfillReconAutoSaveForDate(reconDate, { facilityId = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reconDate || ""))) {
    throw new Error("reconDate must be YYYY-MM-DD");
  }
  if (db.business?.ensureReconDefaultColumns) {
    await db.business.ensureReconDefaultColumns();
  }
  const where = { recon_auto_save_enabled: true };
  if (facilityId) where.id = facilityId;
  const businesses = await db.business.findAll({ where });
  const results = [];
  for (const business of businesses) {
    try {
      const summary = await saveOpenHandIns(business, reconDate);
      results.push({
        facilityId: business.id,
        success: true,
        ...summary,
      });
      console.log(
        `[recon-auto-save] backfill ${business.id} ${reconDate}: open=${summary.open} saved=${summary.saved} skipped=${summary.skipped}`,
      );
    } catch (err) {
      console.error(
        `[recon-auto-save] backfill failed ${business.id} ${reconDate}:`,
        err.message,
      );
      results.push({
        facilityId: business.id,
        success: false,
        error: err.message,
      });
    }
  }
  return results;
}

function startCollectionReconAutoSaveCron() {
  // Automatic hand-in save is turned off. Past days stay on History via migration.
  console.log("[recon-auto-save] Automatic save is off");
  return null;
}

module.exports = {
  startCollectionReconAutoSaveCron,
  runScheduledReconAutoSave,
  saveOpenHandIns,
  backfillReconAutoSaveForDate,
  datesDueForBusiness,
};

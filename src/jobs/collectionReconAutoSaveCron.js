"use strict";

const db = require("../models");
const collectionReconciliation = require("../controller/collectionReconciliation");
const { getNowPartsInTimezone } = require("../services/invoiceClosingService");

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

  return { saved, skipped, blocked, open: open.length };
}

async function processFacility(business, now = new Date()) {
  const parts = getNowPartsInTimezone(
    business.recon_auto_save_timezone || "Africa/Lagos",
    now,
  );
  const summary = await saveOpenHandIns(business, parts.date);
  if (!summary.blocked) {
    await db.business.update(
      { recon_auto_save_last_run: parts.date },
      { where: { id: business.id } },
    );
  }
  if (summary.open > 0) {
    console.log(
      `[recon-auto-save] ${business.id}: open=${summary.open} saved=${summary.saved} skipped=${summary.skipped}`,
    );
  }
  return summary;
}

async function runScheduledReconAutoSave(now = new Date(), { verbose = false } = {}) {
  if (db.business?.ensureReconDefaultColumns) {
    await db.business.ensureReconDefaultColumns();
  }
  const businesses = await db.business.findAll({
    where: { recon_auto_save_enabled: true },
  });

  const results = [];
  let dueCount = 0;
  for (const business of businesses) {
    try {
      if (!isPastSaveTime(business, now)) continue;
      const parts = getNowPartsInTimezone(
        business.recon_auto_save_timezone || "Africa/Lagos",
        now,
      );
      const lastRun = business.recon_auto_save_last_run
        ? String(business.recon_auto_save_last_run).slice(0, 10)
        : null;
      if (lastRun === parts.date) continue;
      dueCount += 1;
      const summary = await processFacility(business, now);
      results.push({ facilityId: business.id, success: true, ...summary });
    } catch (err) {
      console.error(`[recon-auto-save] Failed for ${business.id}:`, err.message);
      results.push({
        facilityId: business.id,
        success: false,
        error: err.message,
      });
    }
  }

  if (verbose || dueCount > 0) {
    console.log(
      `[recon-auto-save] ${businesses.length} enabled, ${dueCount} due`,
    );
  }
  return results;
}

function startCollectionReconAutoSaveCron() {
  if (process.env.ENABLE_RECON_AUTO_SAVE_CRON === "false") {
    console.log("[recon-auto-save] Disabled via ENABLE_RECON_AUTO_SAVE_CRON=false");
    return null;
  }
  const intervalMs = Math.max(
    15000,
    parseInt(process.env.RECON_AUTO_SAVE_POLL_MS, 10) || 60 * 1000,
  );
  const tick = (verbose = false) => {
    runScheduledReconAutoSave(new Date(), { verbose }).catch((err) =>
      console.error("[recon-auto-save] Unhandled error:", err),
    );
  };
  tick(true);
  const timer = setInterval(() => tick(false), intervalMs);
  console.log(
    `[recon-auto-save] Polling every ${Math.round(intervalMs / 1000)}s`,
  );
  return timer;
}

module.exports = {
  startCollectionReconAutoSaveCron,
  runScheduledReconAutoSave,
};

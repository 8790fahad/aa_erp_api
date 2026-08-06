"use strict";

const cron = require("node-cron");
const db = require("../models");
const { runBulkDepreciation } = require("../controller/assets");

const FREQUENCY_MONTHS = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

const pad2 = (n) => String(n).padStart(2, "0");

const toDateOnly = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

const endOfPreviousMonth = (now = new Date()) => {
  const d = new Date(now.getFullYear(), now.getMonth(), 0);
  return toDateOnly(d);
};

/**
 * Decide if a business should run auto-depreciation today.
 */
function shouldRunToday(business, now = new Date()) {
  if (!business?.auto_depreciation_enabled) return false;

  const day = Math.min(28, Math.max(1, parseInt(business.auto_depreciation_day, 10) || 1));
  if (now.getDate() !== day) return false;

  const frequency = business.auto_depreciation_frequency || "monthly";
  const month = now.getMonth(); // 0-11

  if (frequency === "quarterly" && ![0, 3, 6, 9].includes(month)) {
    return false;
  }
  if (frequency === "yearly" && month !== 0) {
    return false;
  }

  const lastRun = business.auto_depreciation_last_run
    ? String(business.auto_depreciation_last_run).slice(0, 10)
    : null;
  const today = toDateOnly(now);
  if (lastRun === today) return false;

  // Skip if already ran this calendar period
  if (lastRun) {
    const [ly, lm] = lastRun.split("-").map(Number);
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    if (frequency === "monthly" && ly === y && lm === m) return false;
    if (frequency === "quarterly") {
      const lastQ = Math.floor((lm - 1) / 3);
      const thisQ = Math.floor((m - 1) / 3);
      if (ly === y && lastQ === thisQ) return false;
    }
    if (frequency === "yearly" && ly === y) return false;
  }

  return true;
}

async function processFacility(business, now = new Date()) {
  const facilityId = business.id;
  const frequency = business.auto_depreciation_frequency || "monthly";
  const periodMonths = FREQUENCY_MONTHS[frequency] || 1;
  const periodEndDate = endOfPreviousMonth(now);

  console.log(
    `[depreciation-cron] Running for ${business.business_name || facilityId} (${frequency}, ${periodMonths} mo, as of ${periodEndDate})`,
  );

  const result = await runBulkDepreciation({
    facilityId,
    periodEndDate,
    periodMonths,
    createdBy: "SYSTEM-CRON",
  });

  await db.business.update(
    { auto_depreciation_last_run: toDateOnly(now) },
    { where: { id: facilityId } },
  );

  console.log(
    `[depreciation-cron] Done ${facilityId}: ${result.processedAssets} assets, book=${result.totalBookDepreciation}, journal=${result.journalRef || "n/a"}`,
  );

  return result;
}

async function runScheduledDepreciation(now = new Date()) {
  const businesses = await db.business.findAll({
    where: { auto_depreciation_enabled: true },
    attributes: [
      "id",
      "business_name",
      "auto_depreciation_enabled",
      "auto_depreciation_frequency",
      "auto_depreciation_day",
      "auto_depreciation_last_run",
    ],
  });

  const due = businesses.filter((b) => shouldRunToday(b, now));
  console.log(
    `[depreciation-cron] Check ${toDateOnly(now)}: ${businesses.length} enabled, ${due.length} due`,
  );

  const results = [];
  for (const business of due) {
    try {
      const result = await processFacility(business, now);
      results.push({ facilityId: business.id, success: true, result });
    } catch (err) {
      console.error(
        `[depreciation-cron] Failed for ${business.id}:`,
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

/**
 * Start daily cron (default 01:15 server time).
 * Override with DEPRECIATION_CRON_SCHEDULE env (node-cron syntax).
 */
function startDepreciationCron() {
  if (process.env.ENABLE_DEPRECIATION_CRON === "false") {
    console.log("[depreciation-cron] Disabled via ENABLE_DEPRECIATION_CRON=false");
    return null;
  }

  const schedule =
    process.env.DEPRECIATION_CRON_SCHEDULE || "15 1 * * *"; // 01:15 every day

  const task = cron.schedule(
    schedule,
    () => {
      runScheduledDepreciation().catch((err) =>
        console.error("[depreciation-cron] Unhandled error:", err),
      );
    },
    { scheduled: true },
  );

  console.log(`[depreciation-cron] Scheduled (${schedule})`);
  return task;
}

module.exports = {
  startDepreciationCron,
  runScheduledDepreciation,
  shouldRunToday,
  processFacility,
  FREQUENCY_MONTHS,
};

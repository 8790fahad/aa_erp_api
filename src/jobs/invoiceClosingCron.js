"use strict";

const db = require("../models");
const {
  isPastClosingTime,
  reverseUnpaidNonCreditInvoicesForFacility,
  getNowPartsInTimezone,
} = require("../services/invoiceClosingService");

async function processFacility(business, now = new Date()) {
  const facilityId = business.id;
  const parts = getNowPartsInTimezone(
    business.invoice_closing_timezone || "Africa/Lagos",
    now,
  );

  const lockTx = await db.sequelize.transaction();
  try {
    await db.business.findOne({
      where: { id: facilityId },
      lock: lockTx.LOCK.UPDATE,
      transaction: lockTx,
    });

    console.log(
      `[invoice-closing-cron] Running for ${business.business_name || facilityId} (close ${business.invoice_closing_time} ${business.invoice_closing_timezone || "Africa/Lagos"})`,
    );

    const summary = await reverseUnpaidNonCreditInvoicesForFacility({
      facilityId,
      userId: "system",
      reason: `Auto-reversed after daily closing time ${business.invoice_closing_time} (still on Verification Points, unpaid)`,
    });

    await db.business.update(
      { invoice_closing_last_run: parts.date },
      { where: { id: facilityId }, transaction: lockTx },
    );

    await lockTx.commit();

    if (summary.candidates > 0 || summary.reversed > 0) {
      console.log(
        `[invoice-closing-cron] ${facilityId}: candidates=${summary.candidates} reversed=${summary.reversed} skipped=${summary.skipped || 0} failed=${summary.failed}`,
      );
    }

    return summary;
  } catch (err) {
    await lockTx.rollback().catch(() => {});
    throw err;
  }
}

async function runScheduledInvoiceClosing(now = new Date(), { verbose = false } = {}) {
  const businesses = await db.business.findAll({
    where: { invoice_closing_enabled: true },
  });

  const results = [];
  let dueCount = 0;
  for (const business of businesses) {
    try {
      if (!isPastClosingTime(business, now)) continue;
      dueCount += 1;
      const summary = await processFacility(business, now);
      results.push({ facilityId: business.id, success: true, ...summary });
    } catch (err) {
      console.error(
        `[invoice-closing-cron] Failed for ${business.id}:`,
        err.message,
      );
      results.push({
        facilityId: business.id,
        success: false,
        error: err.message,
      });
    }
  }

  if (verbose || dueCount > 0) {
    console.log(
      `[invoice-closing-cron] ${businesses.length} enabled, ${dueCount} due`,
    );
  }

  return results;
}

/**
 * Poll on an interval (default 60s). node-cron v4 skips ticks that are >1s late,
 * which silently never ran on this Windows/Sequelize server.
 * Each enabled business reverses once per local day after its closing time.
 */
function startInvoiceClosingCron() {
  if (process.env.ENABLE_INVOICE_CLOSING_CRON === "false") {
    console.log(
      "[invoice-closing-cron] Disabled via ENABLE_INVOICE_CLOSING_CRON=false",
    );
    return null;
  }

  const intervalMs = Math.max(
    15000,
    parseInt(process.env.INVOICE_CLOSING_POLL_MS, 10) || 60 * 1000,
  );

  const tick = (verbose = false) => {
    runScheduledInvoiceClosing(new Date(), { verbose }).catch((err) =>
      console.error("[invoice-closing-cron] Unhandled error:", err),
    );
  };

  tick(true);
  const timer = setInterval(() => tick(false), intervalMs);

  console.log(
    `[invoice-closing-cron] Polling every ${Math.round(intervalMs / 1000)}s`,
  );
  return timer;
}

module.exports = {
  startInvoiceClosingCron,
  runScheduledInvoiceClosing,
  processFacility,
  isPastClosingTime,
};

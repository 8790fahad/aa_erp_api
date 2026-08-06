"use strict";

const cron = require("node-cron");
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

  console.log(
    `[invoice-closing-cron] Running for ${business.business_name || facilityId} (close ${business.invoice_closing_time} ${business.invoice_closing_timezone || "Africa/Lagos"})`,
  );

  const summary = await reverseUnpaidNonCreditInvoicesForFacility({
    facilityId,
    userId: "system",
    reason: `Auto-reversed after daily closing time ${business.invoice_closing_time} (unpaid non-credit invoice)`,
  });

  await db.business.update(
    { invoice_closing_last_run: parts.date },
    { where: { id: facilityId } },
  );

  console.log(
    `[invoice-closing-cron] ${facilityId}: candidates=${summary.candidates} reversed=${summary.reversed} failed=${summary.failed}`,
  );

  return summary;
}

async function runScheduledInvoiceClosing(now = new Date()) {
  const businesses = await db.business.findAll({
    where: { invoice_closing_enabled: true },
  });

  const results = [];
  for (const business of businesses) {
    try {
      if (!isPastClosingTime(business, now)) continue;
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
  return results;
}

/**
 * Poll every 5 minutes; each enabled business reverses once per local day
 * after its configured closing time.
 */
function startInvoiceClosingCron() {
  if (process.env.ENABLE_INVOICE_CLOSING_CRON === "false") {
    console.log(
      "[invoice-closing-cron] Disabled via ENABLE_INVOICE_CLOSING_CRON=false",
    );
    return null;
  }

  const schedule =
    process.env.INVOICE_CLOSING_CRON_SCHEDULE || "*/5 * * * *";

  const task = cron.schedule(
    schedule,
    () => {
      runScheduledInvoiceClosing().catch((err) =>
        console.error("[invoice-closing-cron] Unhandled error:", err),
      );
    },
    { scheduled: true },
  );

  console.log(`[invoice-closing-cron] Scheduled (${schedule})`);
  return task;
}

module.exports = {
  startInvoiceClosingCron,
  runScheduledInvoiceClosing,
  processFacility,
  isPastClosingTime,
};

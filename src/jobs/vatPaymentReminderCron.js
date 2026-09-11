"use strict";

const cron = require("node-cron");
const { runVatPaymentReminders } = require("../services/vatPaymentReminder");

async function runScheduledVatPaymentReminders() {
  console.log("[vat-payment-reminder] Checking 21st VAT payment reminder…");
  try {
    const result = await runVatPaymentReminders();
    if (result?.skipped) {
      console.log(
        `[vat-payment-reminder] skipped (${result.reason || "n/a"})`,
      );
      return result;
    }
    console.log(
      `[vat-payment-reminder] facilities=${result.facilities} sent=${result.sent} skipped=${result.skipped}`,
    );
    return result;
  } catch (err) {
    console.error("[vat-payment-reminder] Unhandled error:", err?.message || err);
    return { facilities: 0, sent: 0, error: err?.message };
  }
}

function startVatPaymentReminderCron() {
  if (
    String(process.env.ENABLE_VAT_PAYMENT_REMINDER_CRON || "true").toLowerCase() ===
    "false"
  ) {
    console.log(
      "[vat-payment-reminder] Disabled via ENABLE_VAT_PAYMENT_REMINDER_CRON=false",
    );
    return null;
  }
  // Daily 08:00 Lagos; the job itself only sends on the 21st.
  const schedule = process.env.VAT_PAYMENT_REMINDER_CRON_SCHEDULE || "0 8 * * *";
  const task = cron.schedule(
    schedule,
    () => {
      void runScheduledVatPaymentReminders();
    },
    { scheduled: true, timezone: "Africa/Lagos" },
  );
  console.log(`[vat-payment-reminder] Scheduled (${schedule} Africa/Lagos)`);
  return task;
}

module.exports = {
  startVatPaymentReminderCron,
  runScheduledVatPaymentReminders,
};

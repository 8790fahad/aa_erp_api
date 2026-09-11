"use strict";

const cron = require("node-cron");
const { runRebateRemindersForAllFacilities } = require("../services/rebateReminders");

async function runScheduledRebateReminders() {
  console.log("[rebate-reminders] Checking rebate progress thresholds…");
  try {
    const result = await runRebateRemindersForAllFacilities();
    console.log(
      `[rebate-reminders] facilities=${result.facilities} reminders=${result.sent}`,
    );
    return result;
  } catch (err) {
    console.error("[rebate-reminders] Unhandled error:", err?.message || err);
    return { facilities: 0, sent: 0, error: err?.message };
  }
}

function startRebateRemindersCron() {
  if (String(process.env.ENABLE_REBATE_REMINDERS_CRON || "true").toLowerCase() === "false") {
    console.log("[rebate-reminders] Disabled via ENABLE_REBATE_REMINDERS_CRON=false");
    return null;
  }
  const schedule = process.env.REBATE_REMINDERS_CRON_SCHEDULE || "15 8 * * *";
  const task = cron.schedule(
    schedule,
    () => {
      void runScheduledRebateReminders();
    },
    { scheduled: true },
  );
  console.log(`[rebate-reminders] Scheduled (${schedule})`);
  return task;
}

module.exports = {
  startRebateRemindersCron,
  runScheduledRebateReminders,
};

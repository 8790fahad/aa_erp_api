"use strict";

const cron = require("node-cron");
const db = require("../models");
const { classifyFacility } = require("../controller/crm/classification");

let started = false;

async function runClassificationForAllFacilities() {
  const businesses = await db.sequelize.query(
    `
      SELECT id, business_name
      FROM business
      WHERE IFNULL(LOWER(status), 'active') NOT IN ('inactive', 'disabled', 'deleted', '0')
    `,
    { type: db.sequelize.QueryTypes.SELECT },
  );

  let ok = 0;
  let fail = 0;
  for (const biz of businesses || []) {
    try {
      const result = await classifyFacility(biz.id);
      console.info(
        `[crmClassificationCron] ${biz.business_name || biz.id}: classified ${result.total}, updated ${result.updated}`,
      );
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(
        `[crmClassificationCron] Failed for ${biz.id}:`,
        err.message || err,
      );
    }
  }
  return { ok, fail, total: (businesses || []).length };
}

function startCrmClassificationCron() {
  if (started) return;
  started = true;

  // Daily at 02:15
  cron.schedule("15 2 * * *", async () => {
    console.info("[crmClassificationCron] Starting daily classification…");
    try {
      const summary = await runClassificationForAllFacilities();
      console.info("[crmClassificationCron] Done:", summary);
    } catch (err) {
      console.error("[crmClassificationCron] Fatal:", err.message || err);
    }
  });

  console.info("[crmClassificationCron] Scheduled daily at 02:15");
}

module.exports = {
  startCrmClassificationCron,
  runClassificationForAllFacilities,
};

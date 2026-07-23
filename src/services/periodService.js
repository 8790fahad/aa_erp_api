"use strict";
const db = require("../models");

async function setPeriodStatus({ facilityId, periodId, status, userId }) {
  const valid = ["open", "soft_closed", "closed"];
  if (!valid.includes(status)) throw new Error("Invalid period status");
  const period = await db.Period.findOne({ where: { id: periodId, facilityId } });
  if (!period) throw new Error("Period not found");
  period.status = status;
  period.lockedAt = status !== "open" ? new Date() : null;
  await period.save();
  // Optional: write an audit record if you have audit logs
  return period.get({ plain: true });
}

async function listPeriods({ facilityId }) {
  const rows = await db.Period.findAll({ where: { facilityId }, order: [["startDate", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

module.exports = { setPeriodStatus, listPeriods };









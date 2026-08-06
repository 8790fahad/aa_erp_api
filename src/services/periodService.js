"use strict";
const db = require("../models");
const { recordActivity } = require("./activityAuditService");

async function setPeriodStatus({ facilityId, periodId, status, userId }) {
  const valid = ["open", "soft_closed", "closed"];
  if (!valid.includes(status)) throw new Error("Invalid period status");
  const period = await db.Period.findOne({ where: { id: periodId, facilityId } });
  if (!period) throw new Error("Period not found");
  const beforeStatus = period.status;
  period.status = status;
  period.lockedAt = status !== "open" ? new Date() : null;
  await period.save();
  await recordActivity({
    facilityId,
    userId,
    action: "status_change",
    entityType: "period",
    entityId: periodId,
    entityLabel: period.name || String(periodId),
    before: { status: beforeStatus },
    after: { status },
    remark: `Period status set to ${status}`,
  });
  return period.get({ plain: true });
}

async function listPeriods({ facilityId }) {
  const rows = await db.Period.findAll({ where: { facilityId }, order: [["startDate", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

module.exports = { setPeriodStatus, listPeriods };









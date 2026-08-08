"use strict";

const db = require("../models");

/**
 * Bind the acting user/facility to the MySQL connection so AFTER INSERT/UPDATE/DELETE
 * triggers can stamp `row_change_logs.user_id` (and facility fallback).
 *
 * Uses connection session variables:
 *   @aa_audit_user_id
 *   @aa_audit_facility_id
 */
async function setAuditContext({ userId = null, facilityId = null } = {}) {
  try {
    if (!db.sequelize) return;
    await db.sequelize.query(
      `SET @aa_audit_user_id = :userId, @aa_audit_facility_id = :facilityId`,
      {
        replacements: {
          userId: userId != null && userId !== "" ? String(userId) : null,
          facilityId:
            facilityId != null && facilityId !== "" ? String(facilityId) : null,
        },
      },
    );
  } catch (err) {
    console.warn("[auditContext] failed to set session vars:", err.message);
  }
}

function pickFacility(req) {
  return (
    req.headers?.["x-facility-id"] ||
    req.body?.facilityId ||
    req.body?.facility_id ||
    req.query?.facilityId ||
    req.user?.facilityId ||
    req.user?.facility_id ||
    null
  );
}

function pickUser(req) {
  return (
    req.user?.id ||
    req.user?.userId ||
    req.user?.user_id ||
    req.body?.userId ||
    req.body?.user_id ||
    req.headers?.["x-user-id"] ||
    null
  );
}

/**
 * Express middleware — best-effort JWT/body actor → MySQL session vars.
 * Safe to mount globally; never blocks the request on failure.
 */
function auditContextMiddleware(req, res, next) {
  const run = async () => {
    const userId = pickUser(req);
    const facilityId = pickFacility(req);
    if (userId || facilityId) {
      await setAuditContext({ userId, facilityId });
    }
  };
  run()
    .catch(() => {})
    .finally(() => next());
}

module.exports = {
  setAuditContext,
  auditContextMiddleware,
  pickFacility,
  pickUser,
};

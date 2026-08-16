"use strict";

const passport = require("passport");
const db = require("../models");

/** Max recipients per CRM SMS/email send (override with CRM_MAX_RECIPIENTS). */
const CRM_MAX_RECIPIENTS = Math.min(
  500,
  Math.max(1, parseInt(process.env.CRM_MAX_RECIPIENTS || "100", 10) || 100),
);

function facilityFrom(req) {
  return (
    req.query.facilityId ||
    req.body?.facilityId ||
    req.headers["x-facility-id"] ||
    req.user?.facilityId ||
    null
  );
}

async function userCanAccessFacility(user, facilityId) {
  if (!user || !facilityId) return false;
  if (String(user.facilityId) === String(facilityId)) return true;
  if (user.role === "superAdmin") return true;

  const rows = await db.sequelize.query(
    `
      SELECT 1 AS ok
      FROM membership
      WHERE user_id = :userId
        AND business_id = :facilityId
      LIMIT 1
    `,
    {
      replacements: { userId: user.id, facilityId: String(facilityId) },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * JWT required + facilityId must belong to the caller
 * (user.facilityId, membership, or superAdmin).
 */
function requireCrmAuth(req, res, next) {
  passport.authenticate("jwt", { session: false }, async (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    if (!user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    req.user = user;

    const facilityId = facilityFrom(req);
    if (!facilityId) {
      return res
        .status(400)
        .json({ success: false, error: "facilityId required" });
    }

    try {
      const allowed = await userCanAccessFacility(user, facilityId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: "Forbidden for this facility",
        });
      }
      req.crmFacilityId = String(facilityId);
      return next();
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  })(req, res, next);
}

module.exports = {
  requireCrmAuth,
  facilityFrom,
  userCanAccessFacility,
  CRM_MAX_RECIPIENTS,
};

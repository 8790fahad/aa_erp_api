"use strict";

const db = require("../models");

function pickActor(req) {
  if (!req) return null;
  return (
    req.user?.id ||
    req.user?.userId ||
    req.body?.userId ||
    req.body?.user_id ||
    req.body?.created_by ||
    req.query?.userId ||
    null
  );
}

function safeJson(value) {
  if (value == null) return null;
  try {
    if (typeof value?.toJSON === "function") return value.toJSON();
    if (typeof value?.get === "function") return value.get({ plain: true });
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

/**
 * Append-only mutation trail. Never throws to callers.
 */
async function recordActivity({
  facilityId,
  userId = null,
  action,
  entityType,
  entityId = null,
  entityLabel = null,
  before = null,
  after = null,
  remark = null,
  meta = null,
  transaction = null,
} = {}) {
  try {
    if (!db.activity_audit) return null;
    if (!facilityId || !action || !entityType) return null;
    if (userId == null || userId === "") {
      console.warn(
        `[activity_audit] missing user_id for ${action} ${entityType}:${entityId || ""}`,
      );
    }

    return await db.activity_audit.create(
      {
        facility_id: String(facilityId),
        user_id: userId != null && userId !== "" ? String(userId) : null,
        action: String(action).slice(0, 40),
        entity_type: String(entityType).slice(0, 80),
        entity_id: entityId != null ? String(entityId).slice(0, 120) : null,
        entity_label:
          entityLabel != null ? String(entityLabel).slice(0, 255) : null,
        before_data: safeJson(before),
        after_data: safeJson(after),
        remark: remark != null ? String(remark).slice(0, 500) : null,
        meta: safeJson(meta),
        created_at: new Date(),
      },
      transaction ? { transaction } : undefined,
    );
  } catch (err) {
    console.warn("[activity_audit] failed to record:", err.message);
    return null;
  }
}

async function listActivity({
  facilityId,
  entityType = null,
  entityId = null,
  action = null,
  limit = 50,
  offset = 0,
} = {}) {
  if (!db.activity_audit) return { rows: [], count: 0 };
  const where = { facility_id: facilityId };
  if (entityType) where.entity_type = entityType;
  if (entityId) where.entity_id = entityId;
  if (action) where.action = action;

  const { rows, count } = await db.activity_audit.findAndCountAll({
    where,
    order: [["created_at", "DESC"], ["id", "DESC"]],
    limit: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200),
    offset: Math.max(parseInt(offset, 10) || 0, 0),
  });

  return {
    count,
    rows: rows.map((r) => r.get({ plain: true })),
  };
}

module.exports = {
  recordActivity,
  listActivity,
  pickActor,
  safeJson,
};

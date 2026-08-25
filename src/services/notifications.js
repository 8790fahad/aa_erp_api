"use strict";

const db = require("../models");

/**
 * Fan-out in-app notifications to all business members except the actor.
 * Never throws to callers — failures are logged only.
 */
async function notifyBusinessMembers({
  facilityId,
  excludeUserId = null,
  type,
  title,
  body = null,
  link = null,
  entityType = null,
  entityId = null,
  actorUserId = null,
} = {}) {
  try {
    if (!db.notifications) {
      console.warn("[notifications] model not loaded");
      return null;
    }
    if (!facilityId || !type || !title) return null;

    const members = await db.membership.findAll({
      where: { business_id: String(facilityId) },
      attributes: ["user_id"],
    });

    const exclude = excludeUserId != null ? String(excludeUserId) : null;
    const actor = actorUserId != null ? String(actorUserId) : exclude;
    const recipientIds = [
      ...new Set(
        members
          .map((m) => (m.user_id != null ? String(m.user_id) : null))
          .filter((id) => id && id !== exclude),
      ),
    ];

    if (!recipientIds.length) return [];

    const now = new Date();
    const rows = recipientIds.map((userId) => ({
      facility_id: String(facilityId),
      user_id: userId,
      type: String(type).slice(0, 40),
      title: String(title).slice(0, 255),
      body: body != null ? String(body).slice(0, 500) : null,
      link: link != null ? String(link).slice(0, 255) : null,
      entity_type: entityType != null ? String(entityType).slice(0, 80) : null,
      entity_id: entityId != null ? String(entityId).slice(0, 120) : null,
      actor_user_id: actor,
      read_at: null,
      created_at: now,
    }));

    return await db.notifications.bulkCreate(rows);
  } catch (err) {
    console.warn("[notifications] notifyBusinessMembers failed:", err.message);
    return null;
  }
}

async function listNotifications({
  facilityId,
  userId,
  unreadOnly = false,
  limit = 30,
  offset = 0,
} = {}) {
  if (!db.notifications) return { count: 0, rows: [] };
  if (!facilityId || !userId) return { count: 0, rows: [] };

  const where = {
    facility_id: String(facilityId),
    user_id: String(userId),
  };
  if (unreadOnly) {
    where.read_at = null;
  }

  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);

  return db.notifications.findAndCountAll({
    where,
    order: [["created_at", "DESC"]],
    limit: lim,
    offset: off,
  });
}

async function unreadCount({ facilityId, userId } = {}) {
  if (!db.notifications) return 0;
  if (!facilityId || !userId) return 0;

  return db.notifications.count({
    where: {
      facility_id: String(facilityId),
      user_id: String(userId),
      read_at: null,
    },
  });
}

async function markRead({ facilityId, userId, id } = {}) {
  if (!db.notifications || !facilityId || !userId || !id) return 0;

  const [updated] = await db.notifications.update(
    { read_at: new Date() },
    {
      where: {
        id: Number(id),
        facility_id: String(facilityId),
        user_id: String(userId),
        read_at: null,
      },
    },
  );
  return updated;
}

async function markAllRead({ facilityId, userId } = {}) {
  if (!db.notifications || !facilityId || !userId) return 0;

  const [updated] = await db.notifications.update(
    { read_at: new Date() },
    {
      where: {
        facility_id: String(facilityId),
        user_id: String(userId),
        read_at: null,
      },
    },
  );
  return updated;
}

module.exports = {
  notifyBusinessMembers,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
};

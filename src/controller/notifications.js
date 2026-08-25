"use strict";

const {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
} = require("../services/notifications");

function resolveUserId(req) {
  return (
    req.user?.id ||
    req.user?.userId ||
    req.query?.userId ||
    req.body?.userId ||
    req.body?.user_id ||
    null
  );
}

function resolveFacilityId(req) {
  return (
    req.query?.facilityId ||
    req.body?.facilityId ||
    req.body?.facility_id ||
    null
  );
}

/** GET /api/v1/notifications?facilityId=&userId=&unreadOnly=&limit=&offset= */
exports.list = async (req, res) => {
  try {
    const facilityId = resolveFacilityId(req);
    const userId = resolveUserId(req);
    if (!facilityId || !userId) {
      return res.status(400).json({
        success: false,
        message: "facilityId and userId are required",
      });
    }

    const unreadOnly =
      String(req.query.unreadOnly || "").toLowerCase() === "true" ||
      req.query.unreadOnly === "1";

    const data = await listNotifications({
      facilityId,
      userId,
      unreadOnly,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json({
      success: true,
      count: data.count,
      results: data.rows,
    });
  } catch (error) {
    console.error("notifications.list:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};

/** GET /api/v1/notifications/unread-count?facilityId=&userId= */
exports.countUnread = async (req, res) => {
  try {
    const facilityId = resolveFacilityId(req);
    const userId = resolveUserId(req);
    if (!facilityId || !userId) {
      return res.status(400).json({
        success: false,
        message: "facilityId and userId are required",
      });
    }

    const count = await unreadCount({ facilityId, userId });
    return res.json({ success: true, count });
  } catch (error) {
    console.error("notifications.countUnread:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch unread count",
      error: error.message,
    });
  }
};

/** POST /api/v1/notifications/:id/read  body: { facilityId, userId } */
exports.markOneRead = async (req, res) => {
  try {
    const facilityId = resolveFacilityId(req);
    const userId = resolveUserId(req);
    const id = req.params.id;
    if (!facilityId || !userId || !id) {
      return res.status(400).json({
        success: false,
        message: "facilityId, userId, and id are required",
      });
    }

    const updated = await markRead({ facilityId, userId, id });
    return res.json({ success: true, updated });
  } catch (error) {
    console.error("notifications.markOneRead:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error.message,
    });
  }
};

/** POST /api/v1/notifications/read-all  body: { facilityId, userId } */
exports.markAllAsRead = async (req, res) => {
  try {
    const facilityId = resolveFacilityId(req);
    const userId = resolveUserId(req);
    if (!facilityId || !userId) {
      return res.status(400).json({
        success: false,
        message: "facilityId and userId are required",
      });
    }

    const updated = await markAllRead({ facilityId, userId });
    return res.json({ success: true, updated });
  } catch (error) {
    console.error("notifications.markAllAsRead:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read",
      error: error.message,
    });
  }
};

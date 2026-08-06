"use strict";

const { listActivity } = require("../services/activityAuditService");

exports.getActivityAudits = async (req, res) => {
  try {
    const {
      facilityId,
      entityType,
      entityId,
      action,
      limit = 50,
      offset = 0,
    } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const data = await listActivity({
      facilityId,
      entityType: entityType || null,
      entityId: entityId || null,
      action: action || null,
      limit,
      offset,
    });

    return res.json({
      success: true,
      count: data.count,
      results: data.rows,
    });
  } catch (error) {
    console.error("getActivityAudits:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch activity audit",
      error: error.message,
    });
  }
};

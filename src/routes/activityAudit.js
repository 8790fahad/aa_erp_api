"use strict";

const { getActivityAudits } = require("../controller/activityAudit");

module.exports = (app) => {
  app.get("/api/v1/activity-audits", getActivityAudits);
};

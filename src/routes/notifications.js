"use strict";

module.exports = (app) => {
  const notifications = require("../controller/notifications");

  app.get("/api/v1/notifications/unread-count", notifications.countUnread);
  app.get("/api/v1/notifications", notifications.list);
  app.post("/api/v1/notifications/read-all", notifications.markAllAsRead);
  app.post("/api/v1/notifications/:id/read", notifications.markOneRead);
};

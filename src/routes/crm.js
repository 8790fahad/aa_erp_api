module.exports = (app) => {
  const multer = require("multer");
  const crm = require("../controller/crm");
  const sms = require("../controller/crm/sms");
  const email = require("../controller/crm/email");
  const { requireCrmAuth } = require("../middleware/crmAuth");

  const emailUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB per file
      files: 5,
    },
  });

  app.get("/api/v1/crm/dashboard", requireCrmAuth, crm.getDashboard);

  app.get("/api/v1/crm/customers", requireCrmAuth, crm.listCustomers);
  app.get(
    "/api/v1/crm/customers/:customerNo",
    requireCrmAuth,
    crm.getCustomer360,
  );
  app.get(
    "/api/v1/crm/customers/:customerNo/timeline",
    requireCrmAuth,
    crm.getCustomerTimeline,
  );
  app.put(
    "/api/v1/crm/customers/:customerNo/meta",
    requireCrmAuth,
    crm.updateCustomerMeta,
  );
  app.post(
    "/api/v1/crm/customers/bulk-meta",
    requireCrmAuth,
    crm.bulkUpdateMeta,
  );

  app.get("/api/v1/crm/activities", requireCrmAuth, crm.listActivities);
  app.post("/api/v1/crm/activities", requireCrmAuth, crm.createActivity);
  app.put("/api/v1/crm/activities/:id", requireCrmAuth, crm.updateActivity);
  app.delete(
    "/api/v1/crm/activities/:id",
    requireCrmAuth,
    crm.deleteActivity,
  );

  app.get("/api/v1/crm/followups", requireCrmAuth, crm.listFollowups);
  app.post("/api/v1/crm/followups", requireCrmAuth, crm.createFollowup);
  app.put("/api/v1/crm/followups/:id", requireCrmAuth, crm.updateFollowup);
  app.delete(
    "/api/v1/crm/followups/:id",
    requireCrmAuth,
    crm.deleteFollowup,
  );

  app.get("/api/v1/crm/segments", requireCrmAuth, crm.listSegments);
  app.post("/api/v1/crm/segments", requireCrmAuth, crm.createSegment);
  app.put("/api/v1/crm/segments/:id", requireCrmAuth, crm.updateSegment);
  app.delete(
    "/api/v1/crm/segments/:id",
    requireCrmAuth,
    crm.deleteSegment,
  );

  app.get("/api/v1/crm/settings", requireCrmAuth, crm.getSettings);
  app.put("/api/v1/crm/settings", requireCrmAuth, crm.updateSettings);
  app.post("/api/v1/crm/classify", requireCrmAuth, crm.classify);

  app.get("/api/v1/crm/sms/templates", requireCrmAuth, sms.listTemplates);
  app.post("/api/v1/crm/sms/templates", requireCrmAuth, sms.createTemplate);
  app.put(
    "/api/v1/crm/sms/templates/:id",
    requireCrmAuth,
    sms.updateTemplate,
  );
  app.delete(
    "/api/v1/crm/sms/templates/:id",
    requireCrmAuth,
    sms.deleteTemplate,
  );
  app.get("/api/v1/crm/sms/logs", requireCrmAuth, sms.listSmsLogs);
  app.post("/api/v1/crm/sms/send", requireCrmAuth, sms.sendBulkSms);

  app.get("/api/v1/crm/email/logs", requireCrmAuth, email.listEmailLogs);
  app.post(
    "/api/v1/crm/email/send",
    requireCrmAuth,
    emailUpload.array("attachments", 5),
    email.sendBulkEmail,
  );
};

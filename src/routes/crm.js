module.exports = (app) => {
  const crm = require("../controller/crm");
  const sms = require("../controller/crm/sms");

  app.get("/api/v1/crm/dashboard", crm.getDashboard);

  app.get("/api/v1/crm/customers", crm.listCustomers);
  app.get("/api/v1/crm/customers/:customerNo", crm.getCustomer360);
  app.get("/api/v1/crm/customers/:customerNo/timeline", crm.getCustomerTimeline);
  app.put("/api/v1/crm/customers/:customerNo/meta", crm.updateCustomerMeta);
  app.post("/api/v1/crm/customers/bulk-meta", crm.bulkUpdateMeta);

  app.get("/api/v1/crm/activities", crm.listActivities);
  app.post("/api/v1/crm/activities", crm.createActivity);
  app.put("/api/v1/crm/activities/:id", crm.updateActivity);
  app.delete("/api/v1/crm/activities/:id", crm.deleteActivity);

  app.get("/api/v1/crm/followups", crm.listFollowups);
  app.post("/api/v1/crm/followups", crm.createFollowup);
  app.put("/api/v1/crm/followups/:id", crm.updateFollowup);
  app.delete("/api/v1/crm/followups/:id", crm.deleteFollowup);

  app.get("/api/v1/crm/segments", crm.listSegments);
  app.post("/api/v1/crm/segments", crm.createSegment);
  app.put("/api/v1/crm/segments/:id", crm.updateSegment);
  app.delete("/api/v1/crm/segments/:id", crm.deleteSegment);

  app.get("/api/v1/crm/settings", crm.getSettings);
  app.put("/api/v1/crm/settings", crm.updateSettings);
  app.post("/api/v1/crm/classify", crm.classify);

  app.get("/api/v1/crm/sms/templates", sms.listTemplates);
  app.post("/api/v1/crm/sms/templates", sms.createTemplate);
  app.put("/api/v1/crm/sms/templates/:id", sms.updateTemplate);
  app.delete("/api/v1/crm/sms/templates/:id", sms.deleteTemplate);
  app.get("/api/v1/crm/sms/logs", sms.listSmsLogs);
  app.post("/api/v1/crm/sms/send", sms.sendBulkSms);
};

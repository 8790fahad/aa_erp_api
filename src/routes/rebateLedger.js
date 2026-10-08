module.exports = (app) => {
  const rebate = require("../controller/rebateLedger");

  app.get("/api/v1/rebate-ledger/rules", rebate.listRules);
  app.post("/api/v1/rebate-ledger/rules", rebate.createRule);
  app.delete("/api/v1/rebate-ledger/rules/:id", rebate.deleteRule);

  app.get("/api/v1/rebate-ledger/statuses", rebate.listStatuses);
  app.put("/api/v1/rebate-ledger/statuses", rebate.upsertStatus);
  app.post(
    "/api/v1/rebate-ledger/issue-credit-note",
    rebate.issueCreditNote,
  );
  app.post(
    "/api/v1/rebate-ledger/issue-payment",
    rebate.issuePayment,
  );

  const grants = require("../controller/rebateGrants");
  app.get("/api/v1/rebate-ledger/grants", grants.listGrants);
  app.post("/api/v1/rebate-ledger/grants", grants.createGrant);
  app.post(
    "/api/v1/rebate-ledger/grants/:id/issue-credit-note",
    grants.issueGrantCreditNote,
  );
  app.post(
    "/api/v1/rebate-ledger/grants/:id/issue-payment",
    grants.issueGrantPayment,
  );
  app.delete("/api/v1/rebate-ledger/grants/:id", grants.deleteGrant);
};

module.exports = (app) => {
  const saleWorkflow = require("../controller/saleWorkflow");

  app.get("/api/v1/sale-workflows/stages", saleWorkflow.getWorkflowStages);
  app.get("/api/v1/sale-workflows/cashier-dashboard", saleWorkflow.getCashierDashboard);
  app.get(
    "/api/v1/sale-workflows/warehouse-requests",
    saleWorkflow.listWarehouseRequests,
  );
  app.get("/api/v1/sale-workflows/fulfillments", saleWorkflow.listSaleFulfillments);
  app.get("/api/v1/sale-workflows/fulfillment", saleWorkflow.getSaleFulfillment);
  app.post(
    "/api/v1/sale-workflows/fulfillment/print",
    saleWorkflow.markFulfillmentPrinted,
  );
  app.post(
    "/api/v1/sale-workflows/complete-separation",
    saleWorkflow.completeSeparation,
  );
  app.post(
    "/api/v1/sale-workflows/fulfillment/collect",
    saleWorkflow.markFulfillmentCollected,
  );
  app.get("/api/v1/sale-workflows", saleWorkflow.listSaleWorkflows);
  app.get("/api/v1/sale-workflows/one", saleWorkflow.getSaleWorkflow);
  app.post("/api/v1/sale-workflows/advance", saleWorkflow.advanceSaleWorkflow);
  app.post(
    "/api/v1/sale-workflows/cashier-confirm",
    saleWorkflow.cashierConfirmPayment,
  );
  app.post(
    "/api/v1/sale-workflows/special-treatment",
    saleWorkflow.applySpecialInvoiceTreatment,
  );
};

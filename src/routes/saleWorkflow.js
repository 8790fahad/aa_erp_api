module.exports = (app) => {
  const saleWorkflow = require("../controller/saleWorkflow");

  app.get("/api/v1/sale-workflows/stages", saleWorkflow.getWorkflowStages);
  app.get("/api/v1/sale-workflows", saleWorkflow.listSaleWorkflows);
  app.get("/api/v1/sale-workflows/one", saleWorkflow.getSaleWorkflow);
  app.post("/api/v1/sale-workflows/advance", saleWorkflow.advanceSaleWorkflow);
};

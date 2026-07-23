module.exports = (app) => {
  const production = require("../controller/production");

  // Production routes
  app.post("/api/production/create-bom", production.createBillOfMaterials);
  app.post("/api/production/create-order", production.createProductionOrder);
  app.post(
    "/api/production/update-progress",
    production.updateProductionProgress
  );
  app.get("/api/production/orders", production.getProductionOrders);
  app.get("/api/production/bill-of-materials", production.getBillOfMaterials);
  app.post("/api/production/create-requisition", production.createRequisition);
  
  // Material Requisition routes
  app.post("/api/production/material-requisitions/create", production.createMaterialRequisition);
  app.get("/api/production/material-requisitions", production.getMaterialRequisitions);
  app.get(
    "/api/production/material-requisitions/:id/postings",
    production.getMaterialRequisitionPostings,
  );
  app.get("/api/production/material-requisitions/:id", production.getMaterialRequisitionById);
  app.post("/api/production/material-requisitions/update", production.updateMaterialRequisition);
  app.post("/api/production/material-requisitions/approve", production.approveMaterialRequisition);
  app.post("/api/production/material-requisitions/issue", production.issueMaterials);
  app.post(
    "/api/production/material-requisitions/correct",
    production.correctMaterialRequisition,
  );
  app.post(
    "/api/production/material-requisitions/delete-with-postings",
    production.deleteMaterialRequisitionWithPostings,
  );

  //
  // app.post("/api/production/get-items", production.getItems);
  app.get("/api/production/list", production.getProductionList);
};

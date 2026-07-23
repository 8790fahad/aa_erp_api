module.exports = (app) => {
  const productionRecords = require("../controller/productionRecords");
  const productionManufacturingRecords = require("../controller/productionManufacturingRecords");

  // Production Records routes
  app.post("/api/production/records", productionRecords.createProductionRecord);
  app.get("/api/production/records", productionRecords.getProductionRecords);
  app.get(
    "/api/production/costing-records",
    productionRecords.getProductionCostingRecords,
  );
  app.post(
    "/api/production/costing-records/:id/reject",
    productionRecords.rejectCostingRecord,
  );
  app.post(
    "/api/production/manufacturing-records",
    productionManufacturingRecords.createManufacturingRecord,
  );
  app.get(
    "/api/production/manufacturing-records",
    productionManufacturingRecords.getManufacturingRecords,
  );
  app.post(
    "/api/production/manufacturing-records/:id/close-run",
    productionManufacturingRecords.closeManufacturingRun,
  );
  app.get(
    "/api/production/records/:id",
    productionRecords.getProductionRecordById,
  );

  // New routes for finished goods and production items
  app.get("/api/production/wip", productionRecords.getFinishedGoodsFromWIP);
  app.get("/api/production/items", productionRecords.getProductionItems);
};

module.exports = (app) => {
  const productionReports = require("../controller/productionReports");

  // Production Reports routes
  app.post("/api/reports/cogm", productionReports.getCOGMReport);
  app.post("/api/reports/cogs", productionReports.getCOGSReport);
  app.post(
    "/api/reports/inventory-valuation",
    productionReports.getInventoryValuationReport
  );
  app.post(
    "/api/reports/production-efficiency",
    productionReports.getProductionEfficiencyReport
  );
  app.post("/api/reports/tax-summary", productionReports.getTaxSummaryReport);

  // Production reporting module (demo)
  app.post(
    "/api/reports/production/operator-production",
    productionReports.getOperatorProductionReport,
  );
  app.post(
    "/api/reports/production/product-summary",
    productionReports.getProductProductionSummaryReport,
  );
  app.post(
    "/api/reports/production/production-vs-sales",
    productionReports.getProductionVsSalesComparisonReport,
  );
  app.post(
    "/api/reports/production/daily-batch-log",
    productionReports.getDailyBatchLog,
  );
  app.post(
    "/api/reports/production/batch-detail",
    productionReports.getBatchDetail,
  );
  app.post(
    "/api/reports/production/production-report",
    productionReports.getProductionReport,
  );
  app.post(
    "/api/reports/inventory/fg",
    productionReports.getFGInventoryReport,
  );
  app.post(
    "/api/reports/inventory/fg-by-location",
    productionReports.getFGInventoryByLocationReport,
  );
  app.post(
    "/api/reports/inventory/rm",
    productionReports.getRMInventoryReport,
  );
  app.post(
    "/api/reports/sales/per-product",
    productionReports.getSalesPerProductReport,
  );
};

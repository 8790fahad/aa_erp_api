const passport = require("passport");

module.exports = (app) => {
  const assets = require("../controller/assets");
  const authenticate = passport.authenticate("jwt", { session: false });

  // Static paths before /:id
  app.get("/api/assets/summary/dashboard", authenticate, assets.getAssetSummary);

  app.post(
    "/api/assets/depreciation/bulk",
    authenticate,
    assets.calculateBulkDepreciation
  );

  // Trigger scheduled auto-depreciation check (admin / testing)
  app.post(
    "/api/assets/depreciation/auto-run",
    authenticate,
    assets.triggerAutoDepreciation
  );

  // Reports (static paths — must come before /:id)
  app.get(
    "/api/assets/reports/register",
    authenticate,
    assets.getAssetRegisterReport
  );
  app.get(
    "/api/assets/reports/depreciation-schedule",
    authenticate,
    assets.getDepreciationScheduleReport
  );
  app.get(
    "/api/assets/reports/movements",
    authenticate,
    assets.getMovementsReport
  );
  app.get(
    "/api/assets/reports/fully-depreciated",
    authenticate,
    assets.getFullyDepreciatedReport
  );
  app.get(
    "/api/assets/reports/maintenance-costs",
    authenticate,
    assets.getMaintenanceCostsReport
  );

  // Maintenance update by maintenance id (static-ish path before /:id CRUD)
  app.put(
    "/api/assets/maintenance/:maintenanceId",
    authenticate,
    assets.updateAssetMaintenance
  );

  // Asset CRUD
  app.post("/api/assets", authenticate, assets.createAsset);
  app.get("/api/assets", authenticate, assets.getAllAssets);
  app.get("/api/assets/:id", authenticate, assets.getAssetById);
  app.put("/api/assets/:id", authenticate, assets.updateAsset);

  // Disposal, write-off, transfer & depreciation
  app.post("/api/assets/:id/dispose", authenticate, assets.disposeAsset);
  app.post("/api/assets/:id/write-off", authenticate, assets.writeOffAsset);
  app.post("/api/assets/:id/transfer", authenticate, assets.transferAsset);
  app.get(
    "/api/assets/:id/depreciation-schedule",
    authenticate,
    assets.getDepreciationSchedule
  );
  app.post(
    "/api/assets/:id/depreciation",
    authenticate,
    assets.recordDepreciation
  );

  // Per-asset maintenance log
  app.get(
    "/api/assets/:id/maintenance",
    authenticate,
    assets.getAssetMaintenance
  );
  app.post(
    "/api/assets/:id/maintenance",
    authenticate,
    assets.createAssetMaintenance
  );
};

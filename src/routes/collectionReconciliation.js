module.exports = (app) => {
  const collectionReconciliation = require("../controller/collectionReconciliation");

  app.get(
    "/api/v1/collection-reconciliation",
    collectionReconciliation.getSummary,
  );
  app.get(
    "/api/v1/collection-reconciliation/:cashierUserId/lines",
    collectionReconciliation.getCashierLines,
  );
  app.post(
    "/api/v1/collection-reconciliation/confirm",
    collectionReconciliation.confirmHandIn,
  );
};

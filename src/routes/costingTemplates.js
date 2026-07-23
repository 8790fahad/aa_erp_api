module.exports = (app) => {
  const costingTemplateController = require("../controller/costingTemplateController");
  const semiFinishedCostingController = require("../controller/semiFinishedCostingController");

  // Semi-finished product costing (dedicated tables; not products.notes)
  app.get(
    "/api/semi-finished-costing",
    semiFinishedCostingController.listSemiFinishedCosting,
  );
  app.put(
    "/api/semi-finished-costing/product/:productId",
    semiFinishedCostingController.upsertSemiFinishedCosting,
  );
  app.delete(
    "/api/semi-finished-costing/template/:templateId",
    semiFinishedCostingController.deleteSemiFinishedCostingTemplate,
  );
  app.delete(
    "/api/semi-finished-costing/product/:productId",
    semiFinishedCostingController.deleteSemiFinishedCosting,
  );

  // Get all costing templates
  app.get(
    "/api/costing-templates",
    costingTemplateController.getCostingTemplates
  );

  // Create costing templates in bulk (and create products)
  app.post(
    "/api/costing-templates/bulk",
    costingTemplateController.createCostingTemplatesBulk
  );

  // Create shared costing template
  app.post(
    "/api/costing-templates/shared",
    costingTemplateController.createSharedCostingTemplate
  );

  // Update costing template
  app.put(
    "/api/costing-templates/:id",
    costingTemplateController.updateCostingTemplate
  );

  // Update all costing template items for a product (bulk)
  app.put(
    "/api/costing-templates/product/:productId",
    costingTemplateController.updateProductCostingItems
  );

  // Delete costing template
  app.delete(
    "/api/costing-templates/:id",
    costingTemplateController.deleteCostingTemplate
  );
};

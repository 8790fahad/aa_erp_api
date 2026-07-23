const allowancesController = require("../controller/allowances");

module.exports = (app) => {
  // Allowances and Deductions Management Routes
  app.post("/api/hr/allowances", allowancesController.createAllowance);
  app.get("/api/hr/allowances", allowancesController.getAllAllowances);
  app.get("/api/hr/allowances/:id", allowancesController.getAllowanceById);
  app.put("/api/hr/allowances/:id", allowancesController.updateAllowance);
  app.delete("/api/hr/allowances/:id", allowancesController.deleteAllowance);
  app.get("/api/hr/allowances/summary", allowancesController.getAllowancesSummary);
};
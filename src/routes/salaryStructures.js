const salaryStructuresController = require("../controller/salaryStructures");

module.exports = (app) => {
  // Salary Structure Management Routes
  app.post("/api/hr/salary-structures", salaryStructuresController.createSalaryStructure);
  app.post("/api/hr/salary-structures/bulk", salaryStructuresController.bulkCreateSalaryStructures);
  app.get("/api/hr/salary-structures", salaryStructuresController.getAllSalaryStructures);
  app.get("/api/hr/salary-structures/:id", salaryStructuresController.getSalaryStructureById);
  app.put("/api/hr/salary-structures/:id", salaryStructuresController.updateSalaryStructure);
  app.delete("/api/hr/salary-structures/:id", salaryStructuresController.deactivateSalaryStructure);
  app.get("/api/hr/salary-structures/summary", salaryStructuresController.getSalaryStructureSummary);
};
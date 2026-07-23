module.exports = (app) => {
  const taxes = require("../controller/taxes");

  // Tax CRUD operations
  app.get("/api/taxes", taxes.getTaxes);
  app.get("/api/get-taxes-by-category", taxes.getTaxesByCategory);
  app.get("/api/taxes/:id", taxes.getTaxById);
  app.post("/api/taxes", taxes.createTax);
  app.put("/api/taxes/:id", taxes.updateTax);
  app.delete("/api/taxes/:id", taxes.deleteTax);
};

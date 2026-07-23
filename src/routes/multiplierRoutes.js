module.exports = (app) => {
  const multiplierController = require("../controller/multiplierController");

  // Multiplier routes
  app.get("/inventory/multipliers", multiplierController.getMultipliersByFacility);
  app.get("/inventory/products-with-multipliers", multiplierController.getProductsWithMultipliers);
};
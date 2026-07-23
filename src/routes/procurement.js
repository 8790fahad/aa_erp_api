module.exports = (app) => {
  const procurement = require("../controller/procurement");

  // Procurement routes
  app.post("/api/procurement/create-po", procurement.createPurchaseOrder);
  app.post("/api/procurement/receive-grn", procurement.receiveGoods);
  app.get("/api/procurement/purchase-orders", procurement.getPurchaseOrders);
  app.get("/api/procurement/materials", procurement.getMaterials);
};

module.exports = (app) => {
  const inventoryProducedGoods = require("../controller/inventoryProducedGoods");

  // Inventory Produced Goods routes
  app.get("/inventory/produced-goods", inventoryProducedGoods.getProducedGoodsForMarkup);
};
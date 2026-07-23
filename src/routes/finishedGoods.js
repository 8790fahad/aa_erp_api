module.exports = (app) => {
  const finishedGoods = require("../controller/finishedGoods");

  // Finished Goods routes
  app.post("/api/finished-goods/add", finishedGoods.addFinishedGoods);
  app.post("/api/finished-goods/transfer", finishedGoods.transferFinishedGoods);
  app.post("/api/finished-goods/dispatch", finishedGoods.dispatchFinishedGoods);
  app.get("/api/finished-goods", finishedGoods.getFinishedGoods);
};

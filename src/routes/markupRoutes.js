module.exports = (app) => {
  const markupController = require("../controller/markupController");

  // Markup routes
  app.get("/inventory/markup-goods", markupController.getGoodsForMarkup);
  app.post("/inventory/markup-update", markupController.updateMarkup);
  app.put("/inventory/markup-selling-price", markupController.updateMarkupSellingPrice);
};


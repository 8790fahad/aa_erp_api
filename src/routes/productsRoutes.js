module.exports = (app) => {
  const productsController = require("../controller/productsController");

  console.log("Registering productsRoutes...");

  // Test route
  app.get("/api/products/test", (req, res) => {
    res.json({
      message: "Products routes are working!",
      timestamp: new Date(),
    });
  });

  // Products routes with /api prefix
  app.get("/api/products/list/:facilityId", productsController.getProductsList);
  app.get("/api/products/get-by-item-type/:facilityId", productsController.getProductByItemType);
  app.get("/api/products/list-by-type/:facilityId", productsController.getProductByType);
  app.get(
    "/api/products/:facilityId/:productId",
    productsController.getProductById
  );
  app.get(
    "/api/products/categories/:facilityId",
    productsController.getProductCategories
  );
  app.get(
    "/api/products/stats/:facilityId",
    productsController.getProductStats
  );

  // Product CRUD routes with /api prefix
  app.post(
    "/api/products/create",
    productsController.createProductWithStoreEntry
  );
  app.post(
    "/api/products/bulk-create-finished-good-and-resalable",
    productsController.bulkCreateProductsFinishedGoodAndResalable
  );
  app.put(
    "/api/products/:facilityId/:productId",
    productsController.updateProduct
  );

  console.log("productsRoutes registered successfully");
};

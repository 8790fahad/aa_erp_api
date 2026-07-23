module.exports = (app) => {
  const products = require("../controller/products");

  // Product CRUD operations
  app.post("/api/products", products.createProduct);
  app.get("/api/products", products.getProducts);
  app.get("/api/products/:id", products.getProductById);
  app.put("/api/products/:id", products.updateProduct);
  app.put("/api/products/:id/notes", products.updateProductNotes);
  app.put("/api/products/:id/taxable", products.updateProductTaxable);
  app.put("/api/products/:id/status", products.updateProductStatus);
  // Toggle product online availability
  app.put("/api/products/:id/online", products.updateProductOnlineStatus);
  app.put("/api/products/:id/price", products.updateProductSellingPrice);
  app.put("/api/products/:id/images", products.updateProductImages);
  app.put("/api/products/:id/description", products.updateProductDescription);
  app.delete("/api/products/:id", products.deleteProduct);

  // Product categories and suppliers
  app.get("/api/products/categories", products.getCategories);
  app.get("/api/products/suppliers", products.getSuppliers);
  app.get("/api/products/accounts", products.getAccounts);
  app.get("/api/products/warehouses", products.getWarehouses);

  // Bulk operations
  app.post("/api/products/bulk-import", products.bulkImport);
  app.post("/api/products/bulk-export", products.bulkExport);

  // Product Multipliers CRUD operations
  app.post("/api/product-multipliers", products.createProductMultiplier);
  app.get("/api/product-multipliers", products.getProductMultipliers);
  app.get("/api/product-multipliers/:id", products.getProductMultiplierById);
  app.put("/api/product-multipliers/:id", products.updateProductMultiplier);
  app.delete("/api/product-multipliers/:id", products.deleteProductMultiplier);
  app.put(
    "/api/product-multipliers/:id/toggle-status",
    products.toggleProductMultiplierStatus
  );
};

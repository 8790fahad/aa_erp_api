module.exports = (app) => {
  const storeEntries = require("../controller/storeEntries");

  // Store Entries Routes
  app.get("/inventory/store-entries", storeEntries.getStoreEntries);
  app.get("/inventory/store-entries/:id", storeEntries.getStoreEntry);
  app.post("/inventory/store-entries", storeEntries.createStoreEntry);
  app.put("/inventory/store-entries/:id", storeEntries.updateStoreEntry);
  app.delete("/inventory/store-entries/:id", storeEntries.deleteStoreEntry);
  app.get(
    "/inventory/store-entries/product/:productId",
    storeEntries.getStoreEntriesByProduct
  );
};

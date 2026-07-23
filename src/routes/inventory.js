module.exports = (app) => {
  const inventory = require("../controller/inventory");
  const inventoryStore = require("../controller/inventoryStoreController");
  const inventoryBatch = require("../controller/inventoryBatchController");
  const goodsTransfers = require("../controller/goodsTransfers");

  app.post(
    "/procurement/update-intentory-price",
    inventory.updateInventoryItemPrice,
  );
  app.get("/supplier/get-supplier-statement", inventory.getSupplierStatment);
  app.get("/inventory/get-item-history", inventory.getItemHistory);

  app.post("/branches/new", inventory.postBranch);
  // app.get('/branches/get', inventory.getBranch)

  app.post("/inventory/new-category/:query_type", inventory.addCategory);
  app.post("/inventory/product-list-1", inventory.getNewProductList);
  app.post("/inventory/product-list-2", inventory.getNewProductList2);
  app.post("/inventory/product-list-3", inventory.getNewProductList3);
  app.get("/branches/get", inventory.getBranch);

  app.post("/inventory/new-category/:query_type", inventory.addCategory);
  app.post("/inventory/product-list", inventory.getProductList);
  app.post("/inventory/supplier-list", inventory.getProductList1);
  app.get("/inventory/get-product-type", inventory.getProductType);
  app.post("/inventory/inventory-list", inventory.getInventory);
  app.post("/inventory/edit-item/:query_type", inventory.editStoreItem);
  app.post("/inventory/transfer-item", inventory.transfer);

  // ==================== UNIT OF MEASURE BASED INVENTORY ROUTES ====================
  app.get(`/inventory/get-category`, inventory.getUnitCategory);
  app.get(`/inventory/get-all-measure/:facilityId`, inventory.getAllMeasure);
  app.post(`/inventory/get-product-category`, inventory.getProductCategory);
  app.post("/inventory/unit-of-measure", inventory.manageUnitOfMeasure);
  app.post(
    "/inventory/unit-of-measure/:query_type",
    inventory.deleteUnitOfMeasure,
  );
  app.get("/inventory/items/get-all", inventory.getItems);

  // app.get('/inventory/items/:query_type/:facilityId/:category', inventory.getItems)

  // ==================== NEW STORE ENTRY BASED INVENTORY ROUTES ====================
  app.get(
    `/inventory/store-entries/list`,
    inventoryStore.getInventoryFromStoreEntries,
  );
  app.get(
    `/inventory/raw-material/list-for-costing-template`,
    inventoryStore.getRawMaterialInventoryForCostingTemplate,
  );
  app.get(
    `/inventory/raw-material/list`,
    inventoryStore.getRawMaterialInventory,
  );
  app.get(
    `/inventory/raw-material/by-department`,
    inventoryStore.getRawMaterialInventoryByDepartment,
  );
  app.get(
    `/inventory/goods-transfer/list`,
    inventoryStore.getInventoryForGoodsTransfer,
  );
  app.get(
    `/inventory/goods-transfer/products`,
    inventoryStore.getGoodsTransferProducts,
  );

  // ==================== GOODS TRANSFER WORKFLOW ====================
  app.post("/inventory/goods-transfers", goodsTransfers.createGoodsTransfer);
  app.get("/inventory/goods-transfers", goodsTransfers.listGoodsTransfers);
  app.get(
    "/inventory/goods-transfers/:id",
    goodsTransfers.getGoodsTransferById,
  );
  app.post(
    "/inventory/goods-transfers/:id/approve",
    goodsTransfers.approveGoodsTransfer,
  );
  app.post(
    "/inventory/goods-transfers/:id/reject",
    goodsTransfers.rejectGoodsTransfer,
  );
  app.get(
    `/inventory/inventory-list-by-branch`,
    inventoryStore.getInventoryForGoodsTransferByBranch,
  );
  app.get(`/inventory/inventory-list-all`, inventoryStore.getInventoryListAll);
  app.get(
    `/inventory/store-entries/item-details`,
    inventoryStore.getInventoryItemDetails,
  );
  app.get(
    `/inventory/store-entries/low-stock`,
    inventoryStore.getLowStockAlerts,
  );
  app.get(
    `/inventory/store-entries/out-of-stock`,
    inventoryStore.getOutOfStockItems,
  );
  app.get(
    `/inventory/store-entries/balances-by-type`,
    inventoryStore.getInventoryBalancesBySalesType,
  );
  app.get(
    `/inventory/store-entries/history-by-type`,
    inventoryStore.getTransactionHistoryBySalesType,
  );
  app.get(
    `/inventory/store-entries/sales-type-summary`,
    inventoryStore.getSalesTypeSummaryReport,
  );

  // ==================== BATCH TRACKING INVENTORY ROUTES ====================
  app.get("/inventory/batches/list", inventoryBatch.getInventoryWithBatches);
  app.get(
    "/inventory/batches/item-details",
    inventoryBatch.getInventoryItemDetails,
  );
  app.post("/inventory/batches/receive", inventoryBatch.receiveInventory);
  app.post("/inventory/batches/issue", inventoryBatch.issueInventory);
  app.get("/inventory/batches/low-stock", inventoryBatch.getLowStockAlerts);
  app.get("/inventory/batches/out-of-stock", inventoryBatch.getOutOfStockItems);
  app.get("/inventory/batches/details", inventoryBatch.getBatchDetails);

  // ==================== SUPPLIERS INFO ROUTES ====================
  app.get("/inventory/suppliers-info", inventory.getSuppliersInfo);
  app.get(
    "/inventory/suppliers-info/:facilityId/:supplier_number",
    inventory.getSupplierInfo,
  );
  app.post("/inventory/suppliers-info", inventory.createSupplierInfo);
  app.put(
    "/inventory/suppliers-info/:facilityId/:supplier_number",
    inventory.updateSupplierInfo,
  );
  app.delete(
    "/inventory/suppliers-info/:facilityId/:supplier_number",
    inventory.deleteSupplierInfo,
  );

  // ==================== SUPPLIER ACCOUNT INFORMATION ROUTES ====================
  app.get("/inventory/supplier-accounts", inventory.getSupplierAccounts);
  app.get("/inventory/supplier-accounts/:id", inventory.getSupplierAccount);
  app.post("/inventory/supplier-accounts", inventory.createSupplierAccount);
  app.put("/inventory/supplier-accounts/:id", inventory.updateSupplierAccount);
  app.delete(
    "/inventory/supplier-accounts/:id",
    inventory.deleteSupplierAccount,
  );

  // ==================== SUPPLIER ENTRIES ROUTES ====================
  app.get("/inventory/supplier-entries", inventory.getSupplierEntries);
  app.get("/inventory/supplier-entries/:id", inventory.getSupplierEntry);
  app.get(
    "/inventory/supplier-entries/get-by-receipt-no/:receiptNo",
    inventory.getSupplierEntry,
  );
  app.get(
    "/inventory/supplier-entries-by-receipt",
    inventory.getSupplierEntriesByReceiptNo,
  );
  app.post("/inventory/supplier-entries", inventory.createSupplierEntry);
  app.put("/inventory/supplier-entries/:id", inventory.updateSupplierEntry);
  app.delete("/inventory/supplier-entries/:id", inventory.deleteSupplierEntry);

  // ==================== WIP INVENTORY ROUTES ====================
  app.get("/inventory/wip", inventory.getWipInventory);
  app.get("/inventory/wip-inventory", inventory.getWipInventory);
  app.get("/inventory/wip/direct", inventoryStore.getWipInventoryDirect);
  app.post(
    "/inventory/check-wip-availability",
    inventory.checkWipInventoryAvailability,
  );
  app.post("/inventory/wip/action", inventory.executeWipAction);
  app.get("/inventory/wip/action-history", inventory.getWipActionHistory);
  app.post("/inventory/write-off", inventory.inventoryWriteOff);

  // ==================== PRODUCED GOODS FOR MARKUP ====================
  app.get("/inventory/produced-goods", inventory.getProducedGoods);

  // ==================== BY-PRODUCT MANAGEMENT ====================
  app.get("/inventory/by-products", inventory.getByProducts);
  app.post("/inventory/by-product-entry", inventory.createByProductEntry);
  app.post("/inventory/finished-good-entry", inventory.createFinishedGoodEntry);
  app.get(
    "/inventory/production-product-entries",
    inventory.getProductionProductEntries,
  );

  app.get("/inventory/get-semifinshed-list",inventory.getSemiFinished)
  app.get("/inventory/product-unit-cost/:sku/:facilityId", inventory.getProductUnitCost)

  // ==================== MIXTURE (Semi-finished Production) ====================
  app.post("/inventory/mixture", inventory.createMixture);
  app.get("/inventory/mixtures", inventory.getMixtures);
};

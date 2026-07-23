const passport = require("passport");

module.exports = (app) => {
  const drugs = require("../controller/drugs");
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;

  app.post("/drugs/new", drugs.addDrug);
  app.post("/drugs/new/batch", drugs.batchAddDrug);
  app.get("/drugs/all/:facilityId", drugs.getAll);
  app.get("/drugs/list", drugs.getDrugList);
  app.post("/drugs/list/new", drugs.addNewDrug);
  app.put("/drugs/update/:drugId", drugs.updateDrug);
  // app.put('/drugs/update/:drugId/:quantity', drugs.updateDrugQttyById);
  app.delete("/drugs/delete/:drugId", drugs.deleteDrug);
  app.get("/drugs/price/:drugId/:facilityId", drugs.getDrugPriceById);
  app.get("/drugs/alert/expiry/:facilityId", drugs.getExpiryAlert);
  app.get("/drugs/expired/:facilityId", drugs.getExpiredDrugs);
  app.get("/drugs/alert/quantity/:facilityId", drugs.getQttyAlert);
  app.post("/drugs/dispense", drugs.dispenseDrugs);
  app.get("/drugs/purchase/all/:facilityId", drugs.getPurchaseRecords);
  app.get("/drugs/dispensary/all/:facilityId", drugs.getDispensaryRecords);
  app.get("/drugs/purchase/pending/:facilityId", drugs.getPendingPurchase);
  app.post("/drugs/sales/new", drugs.newDrugSale);
  app.post("/drugs/purchase/new", drugs.newDrugPurchase);
  app.post("/drugs/move/purchases/dispensary", drugs.moveDrugsToDispensary);
  app.post("/drugs/supplier/purchases/new", drugs.newPurchaseFromSupplier);
  app.get("/drugs/drug/by/code/:drugCode/:facilityId",drugs.getDrugInfoFromDrugCode);
  app.get("/drugs/get/other/expenses/:reqno/:facilityId",drugs.getOtherExpenses);
  app.get("/account/get/receipt/data/:repno/:facilityId",drugs.getReceiptData);
  app.get("/drugs/get/discount/:reqno/:facilityId",drugs.getDiscount);
  app.get("/drugs/dispensary/by/code/:drugCode/:facilityId",drugs.getDrugInfoFromDrugCodeForSale);
  app.post("/drugs/sales/return-outward", drugs.returnDrug);
  // app.post('/drugs/add/drugs', drugs.batchAddDrugsWithoutPurchase)
  app.post("/v1/api/inventory/supplier/new", drugs.addNewSupplier);
  app.post("/drugs/supplier/new", drugs.addNewSupplier);
  app.get("/v1/api/supplier/all/:facilityId", drugs.getAllSuppliers);
    app.get("/v1/api/supplier/one/:facilityId/:supplierId", drugs.getSupplier);
    app.get("/v1/api/supplier/banks/:facilityId", drugs.getAllBanks);
  app.get("/drugs/supplier/all/:facilityId", drugs.getAllSuppliers);
  app.post("/drugs/supplier/update", drugs.updateSupplier);
  app.delete("/drugs/supplier/delete/:supplierId", drugs.deleteSupplier);
  app.get("/drugs/unitOfIssue/:drugName/:facilityId", drugs.getUnitOfIssue);
  app.get("/drugs/sales/summary/:from/:to/:facilityId", drugs.getSaleSummary);
  app.get("/drugs/stock/total/:facilityId", drugs.getPharmTotalStock);
  app.get("/drugs/totalsold/:from/:to/:facilityId",drugs.getDrugsSoldWithinRange);
  app.get("/summary/sales/staff/:from/:to/:facilityId",drugs.getBestSellingStaff);
  app.get("/drugs/summary/top/5/:facilityId",drugs.getTopFivePopularDrugsForToday);
  app.get("/drugs/drugs/all", drugs.getAllDrugs);
  app.get("/drugs/search/:facilityId", drugs.drugSearch);
  app.get("/drugs/sales/search/:branch/:facilityId", drugs.drugSearchForSale);
  app.get(
    "/drugs/reviewer/expenses/:facilityId",
    drugs.select_reviewer_expenses
  );
  app.get("/drugs/sales/quantity/:facilityId", drugs.getDrugQtty);
  app.get("/drugs/factory/quantity/:facilityId", drugs.getFactoryDrugQtty);
  app.get("/filter/purchase/:status/:facilityId", drugs.filterPurchase);
  app.get("/get/reviewer/:facilityId", drugs.getReviewer);

  app.get("/drugs/analytics/profit/:facilityId", drugs.getMostProfitableItems);
  app.get(
    "/drugs/analytics/fastselling/:facilityId",
    drugs.getFastSellingItems
  );
  app.get(
    "/drugs/dispensary/only/balance/:facilityId",
    drugs.getDispensaryBalanceWithoutStore
  );
  app.get("/api/inventory/get/return/:code/:receiptNo", drugs.getReturnedDrugs);
  app.get(
    "/drug/get/supplier/info/:suppliercode/:facilityId",
    drugs.suppliersAccountInfo
  );
  app.put(
    "/drugs/shelf/update/quantity-price",
    drugs.updateDrugDispensaryMarkupAndQuantity
  );
  app.get("/walkin/instant/acct/:facilityId", drugs.getInstantPayment);
  app.get("/drugs/analytics/profit/:facilityId", drugs.getMostProfitableItems);
  app.get(
    "/drugs/analytics/fastselling/:facilityId",
    drugs.getFastSellingItems
  );
  app.get(
    "/drugs/dispensary/only/balance/:facilityId",
    drugs.getDispensaryBalanceWithoutStore
  );
  app.get("/api/inventory/get/return/:code/:receiptNo", drugs.getReturnedDrugs);

  app.put(
    "/drugs/shelf/update/quantity-price",
    drugs.updateDrugDispensaryMarkupAndQuantity
  );
  app.get("/walkin/instant/acct/:facilityId", drugs.getInstantPayment);
  app.delete(
    "/drugs/purchase/delete/:drugName/:facilityId",
    drugs.deleteDrugsPurchase
  );
};

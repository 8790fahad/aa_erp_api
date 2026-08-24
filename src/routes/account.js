const passport = require("passport");
const multer = require("multer");
const {
  chart_of_acct,
  budget,
  generateChartOfAccount,
  CreateAccountUpload,
  create_chart_of_acct,
} = require("../controller/chartOfAccount");
const {
  processGeneralLedgerEntries,
} = require("../controller/api/transactionsApi");
// const { createNewProduction } = require("../controller/production");
const upload = require("../config/new_multer");
const { generateGoodReceive } = require("../controller/goodsReceiveNew");

module.exports = (app) => {
  const account = require("../controller/account");
  const account2 = require("../controller/account2");
  const storage = multer.memoryStorage();
  // const upload = multer({ storage });
  const notImplemented = (name) => (req, res) =>
    res.status(501).json({
      success: false,
      message: `${name} endpoint is not implemented on this server`,
    });
  const originalRouteMethods = {
    get: app.get.bind(app),
    post: app.post.bind(app),
    put: app.put.bind(app),
    delete: app.delete.bind(app),
  };
  const safeRouteHandler = (method, route, handler) =>
    typeof handler === "function"
      ? handler
      : notImplemented(`${method.toUpperCase()} ${route}`);

  ["get", "post", "put", "delete"].forEach((method) => {
    app[method] = (route, ...handlers) =>
      originalRouteMethods[method](
        route,
        ...handlers.map((handler) => safeRouteHandler(method, route, handler)),
      );
  });

  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;

  app.post("/account/head/new", account.creatAccHead);
  app.post(
    "/account/transfer",
    account.transfer || notImplemented("Account transfer"),
  );
  app.post(
    "/account/move-money-to-petty-cash",
    account.moveMoneyToPettyCash || notImplemented("Move money to petty cash"),
  );
  app.get("/account/head/revenue/:facilityId", account.getRevAccHeads);
  app.get("/account/head/deposit/:facilityId", account.getDepositAccHead);
  app.get("/account/head/expenses/:facilityId", account.getExpensesAccHead);
  app.get("/account/head/:facilityId", account.getAccHead);
  app.get(
    "/account/get-supplier-statement/:id/:dateFrom/:dateTo",
    account.getSupplierStatement,
  );
  app.get(
    "/api/v1/get-supplier-balance/:supplierNo/:facilityId",
    account.getSupplierBalanceFromLedger,
  );
  app.get(
    "/api/v1/get-customer-balance/:customerNo/:facilityId",
    account.getCustomerBalanceFromLedger,
  );
  app.get(
    "/account/get/account/statement/:id/:dateFrom/:dateTo",
    account.getAccountStatement,
  );
  app.get("/account/get/receipt", account.getReceipt);
  app.get(
    "/account/generate/item/code/:description/:facilityId",
    account.generate_item_code,
  );
  app.get("/account/sales/:userId/:facilityId", account.getTotalSalesByUser);
  app.get(
    "/account/cash/received/:userId/:facilityId",
    account.getAmountReceived,
  );
  app.get(
    "/account/cash/handedover/:userId/:facilityId",
    account.getAmountHandedOver,
  );
  app.get(
    "/account/chart-of-accounts/:facilityId",
    account.getChartOfAccountsForFacility,
  );
  app.get("/account/chart/:facilityId", account.getAccChart);
  app.get("/account/chart/descendant/:store/:code", account.getChartDescendant);
  app.post("/account/client/update", account.updateClientAcc);

  app.get("/account/overview/:from/:to/:facilityId", account.getOverview);
  app.get(
    "/account/overview-without-store/:from/:to/:facilityId",
    account.getOverviewWithoutStore,
  );

  app.get(
    "/account/drug-count-without-store/:facilityId",
    account.getDrugCountWithoutAStore,
  );
  app.get(
    "/account/factory-inventory/:facilityId",
    account.getFactoryInventory,
  );

  app.get(
    "/get/daily/totalprofit/:from/:to/:facilityId",
    account.getTotalProfit,
  );
  app.get("/get/daily/profit/:from/:to/:facilityId", account.getProfit);
  app.get("/get/daily/sales/:from/:to/:facilityId", account.getDailySales);

  app.get(
    "/account/total/amount/:from/:to/:facilityId",
    account.getSupplierTotalAmount,
  );
  app.get(
    "/account/get/supplierbreakdown/:supplier/:from/:to/:facilityId",
    account.getSupplierBreakdown,
  );
  app.get(
    "/account/get/suppliersummary/all/:from/:to/:facilityId",
    account.getAllSupplierBreakdown,
  );

  // Legacy fixed-asset routes removed in favour of the /api/assets register.
  // app.get("/account/head/assets/:facilityId", account.getAssets);
  // app.post("/account/asset-register", account.saveAssetRegister);

  app.get("/account/summary/:from/:to/:facilityId", account.getDailySummary);
  app.get(
    "/account/user-summary/:username/:from/:to/:facilityId",
    account.getUserDailySummary,
  );
  app.get("/account/expenses/:from/:to/:facilityId", account.getExpenses);
  app.get("/account/supplier/debitors/:facilityId", account.getSupplierDebtors);
  app.get(
    "/account/supplier/creditors/:facilityId",
    account.getSupplierCreditors,
  );
  app.get(
    "/account/supplier/creditors-report/:facilityId",
    account.getSupplierCreditorsReport,
  );

  app.get(
    "/account/customer/debitors/:facilityId",
    account.getCustomerCreditors,
  );
  app.get(
    "/account/customer/creditors/:facilityId",
    account.getCustomerDebtors,
  );
  app.get(
    "/account/customer/creditors/factory/:facilityId",
    account.getCustomerDebtorsForFactory,
  );
  app.get("/account/customer-details", account2.getCustomerDetails);

  app.post("/account/expenditure", account2.getAllExpenditure);

  app.post("/get-all-taxes", account2.taxes);

  app.post("/account/bank/new", account2.CreateNewBanks);

  // Legacy fixed-asset SP route removed in favour of the /api/assets register.
  // app.get("/account/assets/all/:facilityId", account.getAllAssets);
  app.get(
    "/account/report/returned-drugs/:from/:to/:facilityId",
    account.getReturnedDrugsReport,
  );
  app.get(
    "/account/report/supplier-payment/:from/:to/:facilityId",
    account.getSupplierPaymentSummary,
  );
  app.get(
    "/account/report/receivables/:from/:to/:facilityId",
    account.getAllReceivables,
  );

  app.get(
    "/account/chart/next-code/:subhead/:facilityId",
    account.getNextAccChartCode,
  );
  app.post(
    "/account/register/asset-depreciation",
    account.runAssetDepreciation,
  );

  app.get("/account/main-heads/:facilityId", account.getMainHeads);
  app.get(
    "/account/report/trial-balance/:from/:to/:facilityId",
    account.getTrialBalance,
  );
  app.get(
    "/account/report/profit-loss-statement/:from/:to/:facilityId",
    account.getProfitLossStatement,
  );
  app.get(
    "/account/report/financial-position/:from/:to/:facilityId",
    account.getFinancialPosition,
  );
  app.get("/account/revenue/heads/:facilityId", account.getRevenueAccHeads);
  app.put("/account/chart", account.updateAccChart);
  app.get(
    "/account/production/:from/:to/:drug/:facilityId",
    account.getFactoryInventoryAll,
  );
  //Minjirya.....
  app.post("/account/add/purchase-order", account.addPurchaseOrder);
  app.post("/account/add/purchase-order-new", account.addPurchaseOrderNew);
  app.get("/account/get/next-id/:facilityId", account.getNextId);
  app.post("/account/add/expenses-new", account.addExpenses);
  app.get(
    "/account/get/all/expenses/:from/:to/:facilityId",
    account.getAllExpenses,
  );
  app.delete("/account/expenses/delete/:id", account.deleteExpenses);
  app.get(
    "/account/get/expenses/by-request/:request_no/:facilityId",
    account.getAllExpensesByID,
  );
  app.get("/account/get/purchase/all/:facilityId", account.getAllPurchaseOrder);
  app.put(
    "/account/update/expenses/status/:request_no",
    account.updateExpensesStatus,
  );
  app.get(
    "/get/disburse/purchase/order/:facilityId",
    account.getDisbursePurchaseOrder,
  );

  app.get(
    "/account/get/expenses/status/approved/:facilityId",
    account.getExpensesByApproved,
  );
  app.get(
    "/account/get/expenses/status/audited/:facilityId",
    account.getExpensesByAudited,
  );
  app.get(
    "/account/get/expenses/status/pending/:facilityId",
    account.getExpensesByPending,
  );
  app.post("/update/audited/file", account.updateAuditedFile);
  app.post("/account/add-new/expenses-remarks", account.addExpensesRemark);
  app.post(
    "/account/add-new/expenses-remarks-general",
    account.addExpensesRemarkGeneral,
  );
  app.get(
    "/get/number/generator/:query_type/:facilityId",
    account.nurmberGenerator,
  );
  app.post(
    "/account/insert-memo",
    upload.fields([{ name: "memo_documents", maxCount: 5 }]),
    account.insertMemo,
  );
  app.get("/account/get-memo-justification", account.getJustification);
  app.post(
    "/account/update-memo",
    upload.fields([{ name: "memo_documents", maxCount: 5 }]),
    account.updateMemoNew,
  );
  app.post("/account/update-inserted-memo", account.insertUpdateMemoData);
  app.post("/account/memo-item-list", account.memoItemList);

  // New ORM-based endpoint to get reviewed memos with their items
  app.get(
    "/account/get-reviewed-memos-with-items/:facilityId/:userId",
    account.getReviewedMemosWithItems,
  );

  // New endpoint to get approved purchase requisitions with their items
  app.get(
    "/account/get-approved-prs-with-items/:facilityId/:userId",
    account.getApprovedPRsWithItems,
  );
  app.post("/account/update-pr-status", account.updatePRStatus);
  app.post("/account/apply-advance-to-bill", account.applyAdvanceToBill);

  // Close memo (set status to "closed")
  app.post("/account/close-memo", account.closeMemo);

  app.post("/account/update-memo", account.updateMemo);
  app.post("/account/insert-pv", account.createPv);
  app.get("/account/get-pv-by-id", account.getPv);
  app.get("/account/get-pv-and-memo/:facilityId/:status", account.getPvAndMemo);
  app.get(
    "/account/get-memo/:facilityId/:status/:userId/:query_type",
    account.getMemos,
  );
  app.get(
    "/account/get-voucher-memos/:facilityId/:status",
    account.getVoucherMemos,
  );
  // app.post("/account/get-memos-by-id", account.getMemosByID);
  app.post("/account/get-memo", account.getMemosByID);

  app.post("/account/insert-approved-memo", account.insertApprovedMemo);
  app.get("/account/get-memo-by-id/:facilityId/:status", account.getMemoById);
  app.get("/account/get-memo-data-by-id", account.getMemoDataById);
  app.get("/account/get-log-memo", account.getLogMemo);

  app.get("/account/get-banks/:facilityId", account.getBanks);

  app.get("/products/get-product-name/:store", account.getProducts);
  app.get("/products/store/:store", account.getAllProductionsByStore);
  app.get("/products/:production_id", account.getProductionDetailsById);
  app.post("/products/add-product-name", account.productName);
  app.post("/products/add-product-data", account.addProductionData);
  app.post("/account/get-purchase-requisition", account.getRequisition);
  app.post(
    "/account/purchase-requisition",
    upload.fields([{ name: "po_documents", maxCount: 5 }]),
    account.insertRequisition,
  );
  app.get(
    "/account/purchase-order-documents",
    account.getPurchaseOrderDocuments,
  );
  app.post(
    "/account/purchase-order-documents",
    upload.fields([{ name: "po_documents", maxCount: 5 }]),
    account.uploadPurchaseOrderDocuments,
  );
  app.post("/account/update-purchase-requisition", account.updateRequisition);

  app.post(
    "/account/update-payable-code/:head/:facilityId/:user_id",
    account.updatePayableCode,
  );
  app.post(
    "/account/update-inventory-val-method/:method/:facilityId/:user_id",
    account.updateInventoryValMethod,
  );
  app.post(
    "/account/update-costing-method/:method/:facilityId/:user_id",
    account.updateCostingMethod,
  );
  app.post(
    "/account/update-depreciation-method/:method/:facilityId/:user_id",
    account.updateDepreciationMethod,
  );
  app.post(
    "/account/update-invoice-closing/:facilityId/:user_id",
    account.updateInvoiceClosingSettings,
  );
  app.post(
    "/account/run-invoice-closing/:facilityId",
    account.runInvoiceClosingNow,
  );
  app.post(
    "/account/update-default-valuation-source/:source/:facilityId/:user_id",
    account.updateDefaultValuationSource,
  );
  // Toggle business online ordering (WhatsApp store, etc.)
  app.post(
    "/account/update-online-ordering/:enabled/:facilityId/:user_id",
    account.updateOnlineOrdering,
  );
  app.post(
    "/account/generate-marketplace-link/:facilityId/:user_id",
    account.generateMarketplaceLink,
  );
  app.get(
    "/account/check-marketplace-link-user",
    account.checkMarketplaceLinkUser,
  );
  app.post(
    "/account/generate-marketplace-tiny-link/:facilityId/:user_id",
    account.generateMarketplaceTinyLink,
  );
  app.post(
    "/account/update-marketplace-social-media/:facilityId/:user_id",
    account.updateMarketplaceSocialMedia,
  );
  app.post(
    "/account/update-default-receipt-type/:receiptType/:facilityId/:user_id",
    account.updateDefaultReceiptType,
  );
  app.post(
    "/account/update-print-delivery-order/:enabled/:facilityId/:user_id",
    account.updatePrintDeliveryOrder,
  );
  app.post(
    "/account/update-delivery-order-format/:format/:facilityId/:user_id",
    account.updateDeliveryOrderFormat,
  );
  app.post(
    "/account/update-delivery-document-type/:docType/:facilityId/:user_id",
    account.updateDeliveryDocumentType,
  );
  app.post(
    "/account/update-price-setup-resalable-purchase/:enabled/:facilityId/:user_id",
    account.updatePriceSetupResalableOnPurchase,
  );
  app.post(
    "/account/update-enable-production-correction/:enabled/:facilityId/:user_id",
    account.updateEnableProductionCorrection,
  );
  app.post(
    "/account/update-enable-material-requisition/:enabled/:facilityId/:user_id",
    account.updateEnableMaterialRequisition,
  );
  app.post(
    "/account/production-correction/update-date",
    account.updateProductionCorrectionDate,
  );
  {
    const productionCorrection = require("../controller/productionCorrection");
    app.get(
      "/account/production-correction/batches",
      productionCorrection.listBatchesForCorrection,
    );
    app.get(
      "/account/production-correction/:batchNo/postings",
      productionCorrection.getBatchPostings,
    );
    app.post(
      "/account/production-correction/correct",
      productionCorrection.correctBatch,
    );
    app.post(
      "/account/production-correction/delete",
      productionCorrection.deleteBatchWithPostings,
    );
  }
  // app.post("/account/update-seal/:businessId", account.updateSeal);
  app.post("/account/update-seal/:businessId", account.updateSeal);
  app.post("/account/update-stamp/:businessId", account.updateStamp);
  app.post("/account/update-logo/:businessId", account.updateLogo);
  app.post(
    "/account/update-document-header-style/:businessId",
    account.updateDocumentHeaderStyle,
  );
  app.post(
    "/account/update-invoice-notes/:businessId",
    account.updateInvoiceNotes,
  );
  app.post(
    "/account/update-dashboard-widgets/:businessId",
    account.updateDashboardWidgets,
  );

  app.get("/account/get-account-head/:head/:facilityId", account.getAccByHead);
  app.get("/account/get-expense-bill", account.getExpenseBill);
  app.post("/account/generate-good-receive", generateGoodReceive);
  app.post("/account/purchase-stock", account.directPurchaseConsumables);
  app.post("/account/post-bulk-production", account.completeProduction);
  app.post("/account/direct-expenses", account.directExpenses);
  app.get("/account/impress", account.listImpress);
  app.get("/account/impress/one", account.getImpressOne);
  app.delete("/account/impress/:id", account.deleteImpress);
  app.put("/account/impress/:id/date", account.updateImpressDate);
  app.post("/account/direct-consumables", account.directConsumables);
  app.post("/account/purchase-expenses", account.directPurchaseExpenses);
  app.post("/account/supplier-payment", account.supplierPayment);
  app.post("/account/purchase/getPr", account.getRequisitionByPr);
  app.get(
    "/purchase/order/pending/:facilityId",
    account.getAllPurchaseOrderPending,
  );

  app.get("/get_purchase_requisition", account.getAllPurchaseOrderPendingNew);

  app.get(
    "/purchase/order/managed/:facilityId",
    account.getAllPurchaseOrderManage,
  );

  app.get("/purchase-order/pending", account.getPendingPurchaseOrder);
  app.get(
    "/sales/chart-code/account-category",
    account.getChartCodeAndCategory,
  );

  app.get("/account/get/badge/num/:id/:facilityId", account.getBadge);
  app.post("/purchase/send/to", account.sendTo);
  app.get(
    "/audited/purchase/order/:facilityId",
    account.auditedPurchaseOrderPending,
  );
  app.put("/account/update/expenses/byID/:id", account.updateExpenseReq);
  app.post(
    "/account/bank/account/creation/form",
    account.bankAccountCreationForm,
  );
  app.get("/get/bank/account/table/:id", account.getBankAccountTable);
  app.delete("/delete/bank/account/:id", account.deleteBankAccount);
  app.get("/get/supplier/:id/:status/:facilityId", account.getSupplier);
  app.get("/get/supplier-all/:id/:status/:facilityId", account.getSupplier2);
  app.post("/update/bank/account", account.updateBankAccount);
  app.post("/update/purchase/to/pending", account.updatePurchaseToPending);
  app.get("/account/get/all/store-list/:facilityId", account.getStoreList);
  app.get("/account/get/item_name/:facilityId", account.productSearch);
  app.get(
    "/point/of/sale/search/:branch/:facilityId",
    account.pointOfSaleSearch,
  );
  app.get(
    "/branch/store/search/:branch/:facilityId",
    account.branchStoreSearch,
  );
  app.get("/get/all/items/:facilityId", account.getItems);
  app.put("/account/update/new/quantity/:id", account.updateApprovedQty);
  // app.get("/account/purchase-order/approve/:facilityId", account.getAllPurchaseOrderApproved);
  app.post("/account/add-new/store", account.addNewStore);
  // app.put("/account/update/new/quantity/:id", account.updateApprovedQty);
  app.get(
    "/account/purchase-order/approve/:facilityId",
    account.getAllPurchaseOrderApproved,
  );

  app.post("/update/purchase/transaction/status", account.updatePurchaseStatus);
  // app.get("/get/all/items/:facilityId", account.getItems);
  app.put("/account/update/grn/status/:po_id", account.updateGRNStatus);
  app.get(
    "/get/supplier/unfinished/:po_id/:query_type/:facilityId",
    account.getUnfinishedPurchase,
  );
  // app.post("/update/purchase/transaction/status", account.updatePurchaseStatus);
  app.get("/get/all/items_list/:subHead/:facilityId", account.getAllitems);
  app.get(
    "/account/get/items_by_qty/:item/:facilityId",
    account.getItemsItemQty,
  );
  app.post("/account/create/branch", account.createBranches);
  app.post("/account/update/branch", account.updateBranches);
  app.get("/account/get-all/branches/:facilityId", account.getAllBranches);
  app.get("/account/get/branches", account.getBranches);
  app.delete("/account/delete/branches/:id/:facilityId", account.deleteBranche);
  app.post("/account/add-new/tranfer", account.transferItemToPos);
  app.post("/account/good/transfer", account.goodTransfer);
  app.get(
    "/get/branch/location/:branch_location/:facilityId/:item_category",
    account.getBranchLocation,
  );
  app.get("/account/get-new-product/:facilityId", account.getNewProduct);
  app.get(
    "/account/get-ready-for-sales/:facilityId",
    account.getReadyForSalesItems,
  );
  app.get(
    "/account/get-ready-for-sales-by-branch/:facilityId",
    account.getReadyForSalesByBranch,
  );
  app.get(
    "/account/get-service-products/:facilityId",
    account.getServiceProducts,
  );
  app.put(
    "/account/update-service-pricing/:facilityId/:productId",
    account.updateServicePricing,
  );
  app.get("/account/get-taxes/:facilityId", account.getTaxes);
  // app.get(
  //   "/get/branch/location/:branch_location/:facilityId",
  //   account.getBranchLocation
  // );

  app.post("/account/add/sale/items", account.addSaleDepartmentItems);

  app.get("/account/get/inventory/:facilityId", account.getInventory);
  app.get("/account/get/inventory2/:facilityId", account.getInventory2);
  app.post("/account/new/item_description", account.creatNewItemDescription);
  app.get("/account/new/item_chart/:facilityId", account.getItemChart);
  app.get("/account/new/item_head/:facilityId", account.getAllitemsHead);
  app.get(
    "/account/item/next-code/:subhead/:facilityId",
    account.getNextItemChartCode,
  );
  app.get(
    "/account/get/items_by_sub/:subhead/:facilityId",
    account.getItemsBySubHead,
  );
  app.get("/account/get/next-id/remarks/:facilityId", account.getRemarksID);
  app.get(
    "/account/expense/next-id/remarks/:facilityId",
    account.getRemarksForExpID,
  );
  app.get(
    "/account/get-max/remarks/:request_no/:facilityId",
    account.getMaxRemarks,
  );
  app.post("/account/add_new/branch_req", account.addNewBranchReq);
  app.get("/account/get_all/branch_req/:facilityId", account.getAllBranchReq);
  // app.get("/account/branch_req_requisition/id/:facilityId", account.getRequisitionId);
  app.get(
    "/account/branch_req_requisition/requisition_no/:req_status/:requisition_no/:query_type",
    account.getAllBranchReqByReqNo,
  );
  app.put(
    "/account/branch_req_requisition/update",
    account.updateBranchReqByReqNo,
  );
  app.put(
    "/account/branch_req_requisition/single-update",
    account.updateSingleBranchReqByReqNo,
  );
  app.get("/account/requisitions/next-status", account.getNextStatus);
  app.get(
    "/account/branch_req_item/:requisition_no/:facilityId",
    account.getAllBranchItemByReqNo,
  );
  app.put(
    "/account/update/req_branch/:status/:requisition_no",
    account.updateReqStatus,
  );
  app.post(
    "/account/add-new/addition_expenses",
    account.addNewAdditionExpenses,
  );
  app.get(
    "/account/get_details/edit/:accountNo/:facilityId",
    account.getPatientDetailsEdit,
  );
  app.put(
    "/account/update/client-details/:accountNo/:facilityId",
    account.updatePatientDetailsEdit,
  );
  app.put(
    "/account/update/other-expenses/:id/:PONo",
    account.updateOtherExpense,
  );
  app.get(
    "/account/get-branch-requisition/:from/:to/:branch/:facilityId",
    account.getRequisitionSummary,
  );

  app.get("/account/purchase-order/report", account2.getPurchaseOrderReport);
  app.get(
    "/account/purchase-order/transaction-summary",
    account2.getPurchaseOrderTransactionSummary,
  );

  app.get("/account/get-branch-itemlist", account.getBranchItemList);

  app.get("/account/get-logs", account.getLogs);
  app.get("/account/get-user-signature", account.getSignature);

  app.get("/account/users/status/roles", account2.getUserStatusRoles);
  app.get("/account/get-all-report", account2.getAllReport);
  app.post("/account/delete-stock", account.deleteStock);
  app.post("/account/custom-store-process", account.customStoreProcess);
  app.post("/account/chart-of-account", chart_of_acct);
  app.post("/account/create-chart-of-account", create_chart_of_acct);
  app.post("/account/create-account-upload", CreateAccountUpload);
  app.post("/account/post-budget", budget);
  app.get("/account/get-budget", budget);
  app.get(
    "/account/get-account-by-category/:category",
    account.getAccountByCategory,
  );
  app.post("/create-journal-entry", processGeneralLedgerEntries);
  app.post("/account/generate-chart-of-account", generateChartOfAccount);
  app.get("/account/get-account-types/:facilityId", account.getAccountTypes);
  app.get("/account/get-account-statement", account.getAccountStatement);

  // AccountCategory routes
  const accountCategory = require("../controller/accountCategory");
  const invoiceCorrection = require("../controller/invoiceCorrection");
  const journalCorrection = require("../controller/journalCorrection");
  app.get("/account/account-categories", accountCategory.getAccountCategories);
  app.get(
    "/account/account-categories-dropdown",
    accountCategory.getAccountCategoriesForDropdown,
  );
  app.get(
    "/account/account-types-dropdown",
    accountCategory.getAccountTypesForDropdown,
  );
  app.get(
    "/account/detail-types-dropdown",
    accountCategory.getDetailTypesForAccountType,
  );
  app.get(
    "/account/parent-accounts-dropdown",
    accountCategory.getParentAccountsForAccountType,
  );
  app.get(
    "/account/account-types-with-detail-types",
    accountCategory.getAccountTypesWithDetailTypes,
  );
  app.get(
    "/account/account-category-template",
    accountCategory.downloadAccountCategoryTemplate,
  );
  app.post(
    "/account/account-category-upload",
    accountCategory.uploadAccountCategories,
  );
  app.get("/account/account-category", accountCategory.getAccountCategory);
  app.get(
    "/account/production-default-accounts",
    accountCategory.getProductionDefaultAccounts,
  );
  app.post("/account/account-category", accountCategory.createAccountCategory);
  app.put("/account/account-category", accountCategory.updateAccountCategory);
  app.post(
    "/account/account-category/disable",
    accountCategory.disableAccountCategory,
  );
  app.delete(
    "/account/account-category",
    accountCategory.deleteAccountCategory,
  );
  app.post(
    "/account/generate-account-category-code",
    accountCategory.generateAccountCategoryCode,
  );
  app.get(
    "/account/account-category/check-code",
    accountCategory.checkAccountCategoryCode,
  );
  // Pay Supplier Bills
  app.post("/api/supplier/pay-bills", account.paySupplierBills);

  // Hierarchical General Ledger
  app.post(
    "/account/hierarchical-general-ledger",
    account.getHierarchicalGeneralLedger,
  );

  // Payable Ledger
  app.post("/account/payable-ledger", account.getPayableLedger);

  // Receivable Ledger
  app.post("/account/receivable-ledger", account.getReceivableLedger);
  app.post("/account/debtors-report", account.getDebtorsReport);
  app.post(
    "/account/debtors-creditors-report",
    account.getDebtorsCreditorsCombinedReport,
  );
  app.get(
    "/api/v1/get-outstanding-payable-invoices",
    account.getOutstandingPayableInvoices,
  );

  // Update VAT Policy
  app.post(
    "/account/update-vat-policy/:policy/:facilityId/:user_id",
    account.updateVATPolicy,
  );

  // Update Allow Sales Without Stock
  app.post(
    "/account/update-allow-sales-without-stock/:enabled/:facilityId/:user_id",
    account.updateAllowSalesWithoutStock,
  );

  app.post(
    "/account/update-paye-auto-calculation/:enabled/:facilityId/:user_id",
    account.updatePayeAutoCalculation,
  );

  // Account Ledger Report
  app.post("/account/account-ledger-report", account.getAccountLedgerReport);

  // Invoice correction (sync invoices + general_ledger)
  app.get(
    "/account/invoice-correction/invoices",
    invoiceCorrection.listInvoicesForCorrection,
  );
  app.post(
    "/account/invoice-correction/update-date",
    invoiceCorrection.updateInvoiceDateWithLedger,
  );
  app.post(
    "/account/invoice-correction/delete",
    invoiceCorrection.deleteInvoiceWithLedger,
  );

  // Journal entry correction (edit/delete general ledger lines)
  app.get(
    "/account/journal-correction/entries",
    journalCorrection.listJournalEntriesForCorrection,
  );
  app.get(
    "/account/journal-correction/lines",
    journalCorrection.getJournalLinesForCorrection,
  );
  app.post(
    "/account/journal-correction/update-line",
    journalCorrection.updateJournalLineForCorrection,
  );
  app.post(
    "/account/journal-correction/update-date",
    journalCorrection.updateJournalDateForCorrection,
  );
  app.post(
    "/account/journal-correction/delete-line",
    journalCorrection.deleteJournalLineForCorrection,
  );
  app.post(
    "/account/journal-correction/delete",
    journalCorrection.deleteJournalEntryForCorrection,
  );

  // Saved Reports
  app.post("/account/save-report", account.saveAccountReport);
  app.get("/account/saved-reports/:facilityId", account.getSavedReports);
  app.delete(
    "/account/saved-report/:id/:facilityId",
    account.deleteSavedReport,
  );

  app.get = originalRouteMethods.get;
  app.post = originalRouteMethods.post;
  app.put = originalRouteMethods.put;
  app.delete = originalRouteMethods.delete;
};

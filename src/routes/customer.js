const {
  postPvRecords,
  pvCollectionNewData,
  createNewTaxes,
  getPaymentVoucher,
  getBulkPaymentVouchers,
  getPurchaseOrderPdf,
} = require("../controller/pv_records");
const upload = require("../config/new_multer");
const customerTypeController = require("../controller/customerType");

module.exports = (app) => {
  const customer = require("../controller/customer");
  app.post("/v1/customer/deposit", customer.deposit);
  app.post("/customer/post-invoice", customer.postInvoice);
  app.post("/customer/get-invoice", customer.getInvoice);
  app.post("/customer/post-pv_records", postPvRecords);
  app.post(
    "/create-pv-records",
    upload.fields([{ name: "pv_documents", maxCount: 5 }]),
    pvCollectionNewData
  );
  app.post("/create-new-taxes", createNewTaxes);
  app.get("/get/payment/voucher", getPaymentVoucher);
  app.post("/get/bulk/payment/vouchers", getBulkPaymentVouchers);
  app.get("/get/purchase-order-pdf", getPurchaseOrderPdf);
  app.post("/create-customer", customer.CreateCustomer);
  app.post("/create-customer-upload", customer.CreateCustomerUpload);
  app.post("/create-supplier-upload", customer.CreateSupplierUpload);
  app.post("/create-product-upload", customer.CreateProductUpload);
  app.post(
    "/create-product-upload-finished-good",
    customer.CreateProductUploadFinishedGood
  );
  app.post(
    "/create-product-upload-resalable",
    customer.CreateProductUploadResalable
  );
  app.post(
    "/create-product-upload-service",
    customer.CreateProductUploadService
  );
  app.post(
    "/create-product-upload-raw-material",
    customer.CreateProductUploadRawMaterial
  );
  app.post("/create-product-upload-wip", customer.CreateProductUploadWip);
  app.post("/create/new_supplier", customer.CreateSupplier);
  app.post("/update/edit_supplier", customer.UpdateSupplier);
  app.post("/create/supplier_bank_detail", customer.CreateSupplier);
  app.get("/get-customer-by-id", customer.getCustomerById);
  app.post("/customer-deposit", customer.customerDeposit);
  app.get(
    "/custormer-reports/:customer_no/:facilityId",
    customer.getCustomerReports
  );
  app.get(
    "/payment-receipt/:entry_id/:facilityId",
    customer.getCustomerPayment
  );
  app.post("/api/v1/create-customer-deposit", customer.createDeposit);
  app.post(
    "/api/v1/customer-advance-payment",
    customer.createCustomerAdvancePayment,
  );
  app.post(
    "/api/v1/customer-advance-payment-allocate",
    customer.customerAdvancePaymentAllocate,
  );
  app.get(
    "/api/v1/get-customer-balance/:customerNo/:facilityId",
    customer.getCustomerBalance
  );
  app.get(
    "/api/v1/get-customer-deposit/:customerNo/:facilityId/:invoice_ref",
    customer.getCustomerDeposit
  );
  app.get(
    "/api/v1/get-customer-entries-by-receipt",
    customer.getCustomerEntriesByReceiptNo
  );
  app.get(
    "/api/v1/get-customer-advance-history",
    customer.getCustomerAdvanceHistory
  );
  app.get(
    "/api/v1/get-received-payment-history",
    customer.getReceivedPaymentHistory
  );
  app.get("/api/v1/get-outstanding-invoices", customer.getOutstandingInvoices);
  app.get(
    "/api/v1/get-customer-nos-by-branch",
    customer.getCustomerNosByBranch
  );
  app.post("/api/customer-security-deposit", customer.createSecurityDeposit);
  app.get("/api/v1/get-customers-list/:facilityId", customer.getCustomersList);
  app.get(
    "/api/v1/get-suppliers-and-customers/:facilityId",
    customer.getCombinedSuppliersAndCustomers
  );

  app.get("/customer-types/list", customerTypeController.getCustomerTypesList);
  app.post("/customer-types/for-select", customerTypeController.getCustomerTypesForSelect);
  app.get("/customer-types/:id", customerTypeController.getCustomerType);
  app.post("/customer-types", customerTypeController.createCustomerType);
  app.put("/customer-types/:id", customerTypeController.updateCustomerType);
  app.put("/customer-types/:id/toggle-status", customerTypeController.toggleCustomerTypeStatus);
  app.delete("/customer-types/:id", customerTypeController.deleteCustomerType);
};

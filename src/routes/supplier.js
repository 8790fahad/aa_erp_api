const {
  createSupplierBankDetail,
  updateSupplierBankDetail,
  updateSupplierBankDetailStatus,
  getSupplierBankDetails,
  getBankDetailsBySupplier,
  deleteSupplierBankDetail,
  getSupplierDepositBalance,
  getSupplierBalance,
  createSupplierPayment,
  getSupplierDeposit,
  getSupplierPaymentReceipt,
  getSupplierBills,
  getSuppliersByBalance,
} = require("../controller/supplier");

// Import new supplier controller
const {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
  getSupplierStats,
  bulkCreateSuppliers,
} = require("../controller/supplierController");

const upload = require("../config/new_multer");
const supplierAdvancePayment = require("../controller/supplierAdvancePayment");

module.exports = (app) => {
  // ============================================
  // SUPPLIER CRUD OPERATIONS (NEW)
  // ============================================

  // Create a new supplier
  app.post("/api/suppliers", createSupplier);

  // Bulk create suppliers
  app.post("/api/suppliers/bulk", bulkCreateSuppliers);

  // Get all suppliers (with pagination, search, filtering)
  app.get("/api/suppliers", getAllSuppliers);

  // Get supplier statistics
  app.get("/api/suppliers/stats", getSupplierStats);

  // Get a single supplier by ID
  app.get("/api/suppliers/:facilityId/:supplier_number", getSupplierById);

  // Update a supplier
  app.put("/api/suppliers/:facilityId/:supplier_number", updateSupplier);

  // Delete/Deactivate a supplier
  app.delete("/api/suppliers/:facilityId/:supplier_number", deleteSupplier);

  // ============================================
  // SUPPLIER BANK DETAILS & PAYMENTS (EXISTING)
  // ============================================

  app.post("/api/add/supplier-bank-detail", createSupplierBankDetail);
  app.post("/api/update/supplier-bank-detail/by-id", updateSupplierBankDetail);
  app.post(
    "/api/update/supplier-bank-detail/status",
    updateSupplierBankDetailStatus
  );
  app.get("/api/get/supplier-bank-details", getSupplierBankDetails);
  app.get(
    "/api/get/supplier-bank-details/:facilityId/:supplier_number",
    getBankDetailsBySupplier
  );
  app.post("/api/delete/supplier-bank-detail", deleteSupplierBankDetail);

  // Supplier deposit balance route
  app.get(
    "/api/supplier/deposit-balance/:supplier_number",
    getSupplierDepositBalance
  );
  app.get(
    "/api/supplier/balance/:supplier_number/:facilityId",
    getSupplierBalance
  );
  app.post("/api/supplier/create-supplier-payment", createSupplierPayment);
  app.get(
    "/api/v1/get-supplier-deposit/:supplierNo/:facilityId/:invoice_ref",
    getSupplierDeposit
  );
  app.get("/api/supplier/payment-receipt", getSupplierPaymentReceipt);
  app.get("/api/supplier/bills", getSupplierBills);
  app.get("/api/suppliers/get-by-balance", getSuppliersByBalance);

  app.get(
    "/api/v1/get-outstanding-supplier-invoices",
    supplierAdvancePayment.getOutstandingSupplierPurchaseInvoices,
  );
  app.post(
    "/api/v1/supplier-advance-payment",
    supplierAdvancePayment.createSupplierAdvancePayment,
  );
  app.get(
    "/api/v1/get-supplier-advance-history",
    supplierAdvancePayment.getSupplierAdvanceHistory,
  );
  app.post(
    "/api/v1/apply-supplier-advance",
    supplierAdvancePayment.applySupplierAdvanceToBills,
  );
  app.post(
    "/api/v1/move-supplier-deposit-to-git",
    supplierAdvancePayment.moveSupplierDepositToGoodsInTransit,
  );
  app.post(
    "/api/v1/write-off-supplier-git",
    supplierAdvancePayment.writeOffSupplierGoodsInTransit,
  );
};

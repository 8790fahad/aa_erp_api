const customerLedgerController = require("../controller/customerLedger");

module.exports = (app) => {
  // Customer Management Routes
  app.post("/api/v1/customers", customerLedgerController.createCustomer);
  app.get("/api/v1/customers", customerLedgerController.getAllCustomers);
  app.get(
    "/api/v1/customers/:customerNo/balance/:facilityId",
    customerLedgerController.getCustomerBalance
  );

  // Deposit/Payment Routes
  app.post("/api/v1/customers/deposit", customerLedgerController.recordDeposit);

  // Invoice Routes (placeholder for future)
  app.post("/api/v1/customers/invoice", customerLedgerController.createInvoice);
};

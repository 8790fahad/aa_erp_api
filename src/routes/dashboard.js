"use strict";

const account = require("../controller/account");

module.exports = (app) => {
  app.get("/api/invoices/dashboard-summary", account.getInvoiceDashboardSummary);
  app.get(
    "/api/sales/invoices/:from/:to/:facilityId",
    account.getSalesInvoicesForChart,
  );
  app.get(
    "/api/accounts-payable/dashboard-summary",
    account.getAccountsPayableDashboardSummary,
  );
  app.get(
    "/api/accounts-receivable/dashboard-summary",
    account.getAccountsReceivableDashboardSummary,
  );
  app.get(
    "/api/expenses/by-category/:from/:to/:facilityId",
    account.getExpensesByCategory,
  );
  app.get("/api/cash-flow/dashboard/:facilityId", account.getCashFlowDashboard);
  app.get(
    "/api/dashboard/financial-overview",
    account.getFinancialDashboardOverview,
  );
};

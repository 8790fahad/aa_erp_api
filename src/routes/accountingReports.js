const accountingReports = require("../controller/accountingReports");
const taxReports = require("../controller/taxReports");
const profitLoss = require("../controller/profitLossController");

module.exports = (app) => {
  // Financial Statements - IFRS Compliant
  app.post("/accounting/trial-balance", accountingReports.getTrialBalance);
  app.post(
    "/accounting/income-statement",
    accountingReports.getIncomeStatement
  );
  app.post("/accounting/balance-sheet", accountingReports.getBalanceSheet);
  app.post(
    "/accounting/statement-of-financial-position",
    accountingReports.getStatementOfFinancialPosition
  );
  app.post(
    "/accounting/cash-flow-statement",
    accountingReports.getCashFlowStatement
  );
  app.post(
    "/accounting/statement-of-changes-in-equity",
    accountingReports.getStatementOfChangesInEquity
  );
  app.post(
    "/accounting/general-ledger-summary",
    accountingReports.getGeneralLedgerSummary
  );
  app.post("/accounting/general-ledger", accountingReports.getGeneralLedger);
  app.post("/accounting/production-report", accountingReports.getProductionReport);
  app.post("/accounting/sales-report", accountingReports.getSalesReport);
  app.post("/accounting/expenditure-report", accountingReports.getExpenditureReport);
  app.get(
    "/accounting/custom-reports/:facilityId",
    accountingReports.getAccountingCustomReports
  );
  app.post(
    "/accounting/custom-reports",
    accountingReports.createAccountingCustomReport
  );

  // Profit & Loss Summary
  app.post("/accounting/profit-loss-summary", profitLoss.ProfitLossController);

  // Tax Compliance Reports - FIRS Compliant
  app.post("/tax/vat-report", taxReports.getVATReport);
  app.post("/tax/wht-report", taxReports.getWHTReport);
  app.post("/tax/cit-computation", taxReports.getCITComputation);
  app.post("/tax/tax-summary", taxReports.getTaxSummary);
};

const {
    bankReconciliation,
    bankOpeningBalance,
    getBankList,
    createBankList,
    updateBankList,
    deleteBankList,
    createBankAccount,
    bulkCreateBankAccounts,
    getBankAccounts,
    updateBankAccount,
    deleteBankAccount,
    getBankReconciliationList,
    uploadBankStatement,
    getBankStatements,
    getBankStatementTransactions,
    createMatchingRule,
    getMatchingRules,
    getMatchingRuleById,
    updateMatchingRule,
    deleteMatchingRule,
    saveMatch,
    undoMatch,
    createDiscrepancy,
    getDiscrepancies,
    updateDiscrepancy,
    getReconciliationReports,
    getAuditTrail,
    addInterest,
    addCharges,
    reconcileWithDirectPost,
    getReconciliationReportData,
    deleteBankStatementTransactions
} = require("../controller/bank_reconciliation");

module.exports = (app) => {
    // Existing bank reconciliation routes
    app.post("/bank-reconciliation", bankReconciliation);
    app.get("/bank-reconciliation/:facilityId", bankReconciliation);
    app.get("/bank-reconciliation/:facilityId/:bankId", bankReconciliation);
    app.post("/bank-opening-balance", bankOpeningBalance);
    app.get('/bank/list', getBankList);
    app.post("/api/bank-list", createBankList);
    app.put("/api/bank-list", updateBankList);
    app.delete("/api/bank-list", deleteBankList);

    // Bank Reconciliation List route
    app.get("/bank-reconciliation-list", getBankReconciliationList);

    // Bank Statement Upload routes
    app.post("/api/upload/bank-statement", uploadBankStatement);
    app.get("/api/get/bank-statements", getBankStatements);
    app.get("/api/get/bank-statement-transactions/:statementId", getBankStatementTransactions);

    // Bank Account CRUD routes
    app.post("/api/add/bank-account", createBankAccount);
    app.post("/api/bulk/bank-accounts", bulkCreateBankAccounts);
    app.get("/api/get/bank-accounts", getBankAccounts);
    app.put("/api/update/bank-account/by-id/:id", updateBankAccount);
    app.delete("/api/bank-account/:id", deleteBankAccount);

    // Matching Rules CRUD routes
    app.post("/api/add/matching-rule", createMatchingRule);
    app.get("/api/get/matching-rules", getMatchingRules);
    app.get("/api/get/matching-rule/:id", getMatchingRuleById);
    app.put("/api/update/matching-rule/:id", updateMatchingRule);
    app.delete("/api/matching-rule/:id", deleteMatchingRule);

    // Match operations
    app.post("/api/bank-reconciliation/match", saveMatch);
    app.post("/api/bank-reconciliation/unmatch", undoMatch);

    // Discrepancy routes
    app.post("/api/add/discrepancy", createDiscrepancy);
    app.get("/api/get/discrepancies", getDiscrepancies);
    app.put("/api/update/discrepancy/:id", updateDiscrepancy);

    // Reconciliation Reports routes
    app.get("/api/get/reconciliation-reports", getReconciliationReports);
    app.get("/api/get/reconciliation-report-data", getReconciliationReportData);

    // Audit Trail route
    app.get("/api/get/audit-trail", getAuditTrail);

    // Interest and Charges routes
    app.post("/api/add/interest", addInterest);
    app.post("/api/add/charges", addCharges);
    app.post("/api/bank-reconciliation/direct-post-match", reconcileWithDirectPost);
    app.post("/api/bank-reconciliation/delete-statement-transactions", deleteBankStatementTransactions);
}

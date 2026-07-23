const journalEntryController = require("../controller/journalEntryController");

module.exports = (app) => {
  // Create journal entry
  app.post("/api/journals", journalEntryController.createJournalEntry);

  // Get all journal entries with filters - Changed to POST to handle facility_id in body
  app.post("/api/journals/list", journalEntryController.getJournalEntries);

  // Debug endpoint to check what's in the database
  app.get(
    "/api/journals/debug/:facilityId",
    journalEntryController.debugJournalEntries
  );

  // Export journal entries to CSV - Changed to POST
  app.post("/api/journals/export", journalEntryController.exportJournalEntries);

  // Get journal entry by transaction reference
  app.get(
    "/api/journals/:transaction_ref",
    journalEntryController.getJournalEntryByRef
  );

  // Update journal entry (only drafts)
  app.put(
    "/api/journals/:transaction_ref",
    journalEntryController.updateJournalEntry
  );

  // Delete journal entry (only drafts)
  app.delete(
    "/api/journals/:transaction_ref",
    journalEntryController.deleteJournalEntry
  );

  // Post (approve) journal entry
  app.post(
    "/api/journals/:transaction_ref/post",
    journalEntryController.postJournalEntry
  );

  // Reverse posted journal entry
  app.post(
    "/api/journals/:transaction_ref/reverse",
    journalEntryController.reverseJournalEntry
  );

  // Export single journal entry to CSV
  app.get(
    "/api/journals/:transaction_ref/export",
    journalEntryController.exportJournalEntry
  );

  // Get customers and suppliers for journal entry
  app.get(
    "/api/journals/customers-suppliers/:facilityId",
    journalEntryController.getCustomersAndSuppliers
  );
};

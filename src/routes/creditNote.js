module.exports = (app) => {
  const creditNoteController = require("../controller/creditNoteController");
  const creditNoteReasonController = require("../controller/creditNoteReasonController");

  app.get(
    "/api/credit-notes/reason-metadata",
    creditNoteReasonController.getReasonMetadata,
  );
  app.post("/api/credit-notes", creditNoteController.createCreditNote);
  app.post("/api/credit-notes/list", creditNoteController.getCreditNotes);
  app.get("/api/credit-notes/search-invoices", creditNoteController.searchInvoices);
  app.get("/api/credit-notes/invoices/:entityId", creditNoteController.getInvoicesForEntity);
  app.get("/api/credit-notes/:creditNoteNumber", creditNoteController.getCreditNoteDetails);
};






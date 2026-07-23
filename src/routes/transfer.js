const cashTransferController = require("../controller/cashTransfer");

module.exports = (app) => {
// Create a new cash transfer
app.post("/cash-transfer",
  cashTransferController.createCashTransfer
);

// Get all cash transfers for a facility with optional status filtering
app.get("/get-cash-transfers/:facilityId/:status/:userId/list",
  cashTransferController.getAllCashTransfers
);

// Get cash transfers with date range filtering
app.get("/get-cash-transfers/:facilityId/:status/:userId/list/:dateFrom/:dateTo",
  cashTransferController.getAllCashTransfers
);

// Get a specific cash transfer by ID
app.get("/cash-transfer/:transferId/:facilityId",
  cashTransferController.getCashTransferById
);

// Update a cash transfer
app.put("/cash-transfer/:transferId/:facilityId",
  cashTransferController.updateCashTransfer
);

// Delete/cancel a cash transfer
app.delete("/cash-transfer/:transferId/:facilityId",
  cashTransferController.deleteCashTransfer
);

// Get cash transfers by account
app.get("/cash-transfers/:accountId/:facilityId",
  cashTransferController.getCashTransfersByAccount
);

// Search cash transfers
app.get("/search-cash-transfers/:facilityId/:searchTerm",
  cashTransferController.searchCashTransfers
);

// Get cash transfer items list (for modal detail view)
app.post("/cash-transfer-item-list",
  (req, res) => {
    const { transfer_id, date, user_id } = req.body;
    
    res.json({
      success: true,
      results: [],
      attachments: []
    });
  }
);

}
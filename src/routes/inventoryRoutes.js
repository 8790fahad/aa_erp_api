"use strict";
const express = require("express");
const router = express.Router();
const { receiptToGRNI, matchInvoiceToGRNI, issueCOGS } = require("../services/inventoryAdapter");

router.post("/api/v1/inventory/receipt", async (req, res) => {
  try {
    const data = await receiptToGRNI(req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/api/v1/inventory/match", async (req, res) => {
  try {
    const data = await matchInvoiceToGRNI(req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/api/v1/inventory/issue-cogs", async (req, res) => {
  try {
    const data = await issueCOGS(req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;









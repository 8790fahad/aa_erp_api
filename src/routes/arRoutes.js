"use strict";
const express = require("express");
const router = express.Router();
const { postARInvoice, postARReceipt } = require("../services/arAdapter");

router.post("/api/v1/ar/invoice", async (req, res) => {
  try {
    const result = await postARInvoice(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/api/v1/ar/receipt", async (req, res) => {
  try {
    const result = await postARReceipt(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;









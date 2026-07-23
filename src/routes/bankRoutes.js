"use strict";
const express = require("express");
const router = express.Router();
const { postBankCharge, postBankInterest } = require("../services/bankAdapter");

router.post("/api/v1/bank/charge", async (req, res) => {
  try {
    const data = await postBankCharge(req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/api/v1/bank/interest", async (req, res) => {
  try {
    const data = await postBankInterest(req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;









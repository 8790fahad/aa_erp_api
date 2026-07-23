"use strict";
const express = require("express");
const router = express.Router();
const { postAPBill, postAPPayment } = require("../services/apAdapter");

router.post("/api/v1/ap/bill", async (req, res) => {
  try {
    const result = await postAPBill(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/api/v1/ap/payment", async (req, res) => {
  try {
    const result = await postAPPayment(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;









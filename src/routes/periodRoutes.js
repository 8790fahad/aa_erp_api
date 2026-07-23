"use strict";
const express = require("express");
const router = express.Router();
const { setPeriodStatus, listPeriods } = require("../services/periodService");

router.get("/api/v1/periods", async (req, res) => {
  try {
    const data = await listPeriods({ facilityId: req.query.facilityId });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/api/v1/periods/status", async (req, res) => {
  try {
    const data = await setPeriodStatus(req.body);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;









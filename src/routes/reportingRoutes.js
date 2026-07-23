"use strict";
const express = require("express");
const router = express.Router();
const { trialBalance } = require("../services/reportingService");

router.get("/api/v1/reporting/trial-balance", async (req, res) => {
  try {
    const data = await trialBalance({
      facilityId: req.query.facilityId,
      periodId: req.query.periodId,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;









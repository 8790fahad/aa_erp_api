"use strict";
const express = require("express");
const router = express.Router();
const { arAging, apAging, reconcileControl } = require("../services/agingService");

router.get("/api/v1/ar/aging", async (req, res) => {
  try {
    const data = await arAging({
      facilityId: req.query.facilityId,
      arControlAccountId: req.query.accountId,
      asOfDate: req.query.asOfDate,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.get("/api/v1/ap/aging", async (req, res) => {
  try {
    const data = await apAging({
      facilityId: req.query.facilityId,
      apControlAccountId: req.query.accountId,
      asOfDate: req.query.asOfDate,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.get("/api/v1/ar/reconcile", async (req, res) => {
  try {
    const data = await reconcileControl({
      facilityId: req.query.facilityId,
      controlAccountId: req.query.accountId,
      partyType: "customer",
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.get("/api/v1/ap/reconcile", async (req, res) => {
  try {
    const data = await reconcileControl({
      facilityId: req.query.facilityId,
      controlAccountId: req.query.accountId,
      partyType: "vendor",
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;









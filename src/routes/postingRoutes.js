"use strict";
const express = require("express");
const router = express.Router();
const {
  postJournalBatch,
  reverseJournalBatch,
} = require("../services/postingEngine");

router.post("/api/v1/gl/post", async (req, res) => {
  try {
    const result = await postJournalBatch(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/api/v1/gl/reverse", async (req, res) => {
  try {
    const result = await reverseJournalBatch(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;







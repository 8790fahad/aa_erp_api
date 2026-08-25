const db = require("../models");

exports.submitCustomerFeedback = async (req, res) => {
  try {
    const {
      businessId,
      business_id,
      facilityId,
      facility_id,
      sale_code,
      saleCode,
      customer_no,
      customerNo,
      customer_name,
      customerName,
      rating,
      comment,
      phone,
    } = req.body || {};

    const facility = businessId || business_id || facilityId || facility_id;
    if (!facility) {
      return res.status(400).json({
        success: false,
        message: "businessId is required",
      });
    }

    const ratingNum = rating != null && rating !== "" ? Number(rating) : null;
    if (
      ratingNum != null &&
      (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5)
    ) {
      return res.status(400).json({
        success: false,
        message: "rating must be between 1 and 5",
      });
    }

    const text = String(comment || "").trim();
    if (!ratingNum && !text) {
      return res.status(400).json({
        success: false,
        message: "Please provide a rating or comment",
      });
    }

    if (!db.CustomerFeedback) {
      return res.status(500).json({
        success: false,
        message: "Feedback model not loaded — run migrations",
      });
    }

    const row = await db.CustomerFeedback.create({
      facility_id: String(facility),
      sale_code: sale_code || saleCode || null,
      customer_no: customer_no || customerNo || null,
      customer_name: customer_name || customerName || null,
      rating: ratingNum,
      comment: text || null,
      phone: phone || null,
    });

    return res.status(201).json({
      success: true,
      message: "Thank you for your feedback",
      data: { id: row.id },
    });
  } catch (error) {
    console.error("submitCustomerFeedback:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to save feedback",
    });
  }
};

exports.listCustomerFeedback = async (req, res) => {
  try {
    const facilityId =
      req.query.businessId || req.query.facilityId || req.query.business_id;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "businessId is required",
      });
    }
    if (!db.CustomerFeedback) {
      return res.status(500).json({
        success: false,
        message: "Feedback model not loaded",
      });
    }
    const rows = await db.CustomerFeedback.findAll({
      where: { facility_id: facilityId },
      order: [["created_at", "DESC"]],
      limit: 200,
    });
    return res.json({ success: true, results: rows });
  } catch (error) {
    console.error("listCustomerFeedback:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list feedback",
    });
  }
};

const db = require("../models");

function parseYearMonth(yearRaw, monthRaw) {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function serializeRow(row) {
  if (!row) return null;
  const plain = typeof row.toJSON === "function" ? row.toJSON() : row;
  const codes = Array.isArray(plain.selected_codes)
    ? plain.selected_codes.map((c) => String(c || "").trim()).filter(Boolean)
    : [];
  return {
    id: plain.id,
    facility_id: plain.facility_id,
    year: Number(plain.year),
    month: Number(plain.month),
    divisor: String(plain.divisor || ""),
    output_vat: Number(plain.output_vat || 0),
    invoice_count: Number(plain.invoice_count || 0),
    selected_count: Number(plain.selected_count || codes.length),
    selected_codes: codes,
    generated_at: plain.generated_at || null,
    previewed_at: plain.previewed_at || null,
    created_by: plain.created_by || null,
    created_at: plain.created_at || null,
    updated_at: plain.updated_at || null,
  };
}

function alreadySavedMessage(year, month) {
  const label = new Date(year, month - 1, 1).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
  return `${label} is already saved for this facility`;
}

exports.listVatOutputTestHistory = async (req, res) => {
  try {
    const facilityId = String(
      req.query.facilityId || req.body.facilityId || "",
    ).trim();
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!db.VatOutputTestHistory) {
      return res.status(500).json({
        success: false,
        message: "VatOutputTestHistory model not loaded — run migrations",
      });
    }

    const rows = await db.VatOutputTestHistory.findAll({
      where: { facility_id: facilityId },
      order: [
        ["year", "DESC"],
        ["month", "DESC"],
      ],
    });

    return res.json({
      success: true,
      results: rows.map(serializeRow),
    });
  } catch (err) {
    console.error("listVatOutputTestHistory:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Unable to load VAT test history",
    });
  }
};

exports.createVatOutputTestHistory = async (req, res) => {
  try {
    const facilityId = String(
      req.body.facilityId || req.query.facilityId || "",
    ).trim();
    const parsed = parseYearMonth(req.body.year, req.body.month);
    const divisor = String(req.body.divisor || "").trim();
    const divisorNum = Number(String(divisor).replace(/,/g, ""));
    const createdBy = String(
      req.body.created_by || req.body.userId || req.body.user_id || "",
    ).trim();

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!parsed) {
      return res.status(400).json({
        success: false,
        message: "A valid year and month are required",
      });
    }
    if (!Number.isFinite(divisorNum) || divisorNum <= 1) {
      return res.status(400).json({
        success: false,
        message: "Type the divide number, greater than 1. Example: 2, 3, or 4",
      });
    }
    if (!db.VatOutputTestHistory) {
      return res.status(500).json({
        success: false,
        message: "VatOutputTestHistory model not loaded — run migrations",
      });
    }

    const existing = await db.VatOutputTestHistory.findOne({
      where: {
        facility_id: facilityId,
        year: parsed.year,
        month: parsed.month,
      },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: alreadySavedMessage(parsed.year, parsed.month),
      });
    }

    const selectedCodes = Array.isArray(req.body.selectedCodes)
      ? req.body.selectedCodes.map((c) => String(c || "").trim()).filter(Boolean)
      : Array.isArray(req.body.selected_codes)
        ? req.body.selected_codes.map((c) => String(c || "").trim()).filter(Boolean)
        : [];

    try {
      const row = await db.VatOutputTestHistory.create({
        facility_id: facilityId,
        year: parsed.year,
        month: parsed.month,
        divisor: String(divisorNum),
        output_vat: Number(req.body.outputVat ?? req.body.output_vat ?? 0) || 0,
        invoice_count:
          Number(req.body.invoiceCount ?? req.body.invoice_count ?? 0) || 0,
        selected_count:
          Number(
            req.body.selectedCount ??
              req.body.selected_count ??
              selectedCodes.length,
          ) || selectedCodes.length,
        selected_codes: selectedCodes,
        created_by: createdBy || null,
      });

      return res.status(201).json({
        success: true,
        results: serializeRow(row),
      });
    } catch (createErr) {
      if (
        createErr?.name === "SequelizeUniqueConstraintError" ||
        createErr?.parent?.code === "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          success: false,
          message: alreadySavedMessage(parsed.year, parsed.month),
        });
      }
      throw createErr;
    }
  } catch (err) {
    console.error("createVatOutputTestHistory:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Unable to save VAT test history",
    });
  }
};

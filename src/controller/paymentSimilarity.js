const db = require("../models");
const { sqlEq } = require("../utils/sqlCollate");

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function moneyClose(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < 0.02;
}

function considerMatch(bucket, row, criteria) {
  const reasons = [];
  if (criteria.hasAmount && moneyClose(row.amount, criteria.amount)) {
    reasons.push("same_amount");
  }
  const rowNarration = norm(row.narration);
  const wanted = norm(criteria.narration);
  if (criteria.hasNarration && wanted && rowNarration === wanted) {
    reasons.push("same_narration");
  }
  if (!reasons.length) return;
  bucket.push({
    reference: row.reference || "",
    date: row.date || criteria.transactionDate,
    amount: Number(row.amount) || 0,
    narration: String(row.narration || "").trim(),
    type: row.type || "",
    reasons,
  });
}

function dedupe(matches) {
  const seen = new Set();
  const unique = [];
  for (const match of matches) {
    const key = [
      norm(match.reference),
      Number(match.amount || 0).toFixed(2),
      norm(match.narration),
      (match.reasons || []).slice().sort().join(","),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }
  return unique;
}

function payeeHits(row, payeeKeys) {
  const payee = norm(row.payee);
  const description = norm(row.transaction_description);
  const purpose = norm(row.purpose_of_payment);
  return payeeKeys.some((key) => {
    if (!key) return false;
    if (payee && payee === key) return true;
    if (key.length < 4) return false;
    return (
      description === key ||
      purpose === key ||
      description.includes(key) ||
      purpose.includes(key)
    );
  });
}

/**
 * Same payee + transaction date, and either the same amount or the same narration.
 * POST /api/v1/check-similar-payment
 */
exports.checkSimilarPayment = async (req, res) => {
  try {
    const facilityId = req.body.facilityId;
    const supplierNumber = String(
      req.body.supplierNumber || req.body.supplier_number || "",
    ).trim();
    const payeeName = String(
      req.body.payeeName || req.body.payee_name || "",
    ).trim();
    const transactionDate = String(
      req.body.transactionDate || req.body.transaction_date || "",
    ).slice(0, 10);
    const narration = String(req.body.narration || "").trim();
    const amount = Number(req.body.amount);

    if (!facilityId || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
      return res.status(400).json({
        success: false,
        message: "facilityId and transactionDate are required",
        matches: [],
      });
    }

    const hasAmount = Number.isFinite(amount) && amount > 0;
    const hasNarration = narration.length > 0;
    if ((!supplierNumber && !payeeName) || (!hasAmount && !hasNarration)) {
      return res.json({ success: true, matches: [] });
    }

    const criteria = {
      amount,
      narration,
      hasAmount,
      hasNarration,
      transactionDate,
    };
    const matches = [];

    if (supplierNumber) {
      const supplierRows = await db.sequelize.query(
        `SELECT entry_id, description, cost, transaction_date, receiptNo, type
         FROM supplier_entries
         WHERE ${sqlEq("facilityId", ":facilityId")}
           AND ${sqlEq("supplier_number", ":supplierNumber")}
           AND DATE(transaction_date) = DATE(:transactionDate)
         ORDER BY entry_id DESC
         LIMIT 300`,
        {
          replacements: { facilityId, supplierNumber, transactionDate },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      for (const row of supplierRows || []) {
        considerMatch(
          matches,
          {
            reference: row.receiptNo || "",
            date: row.transaction_date,
            amount: row.cost,
            narration: row.description,
            type: row.type || "supplier",
          },
          criteria,
        );
      }
    }

    const ledgerRows = await db.sequelize.query(
      `SELECT reference_number,
              MAX(transaction_date) AS transaction_date,
              MAX(purpose_of_payment) AS purpose_of_payment,
              MAX(transaction_description) AS transaction_description,
              MAX(payee) AS payee,
              SUM(dr) AS debit_total
       FROM general_ledger
       WHERE ${sqlEq("facility_id", ":facilityId")}
         AND DATE(transaction_date) = DATE(:transactionDate)
         AND COALESCE(status, '') <> 'reversed'
       GROUP BY reference_number
       LIMIT 500`,
      {
        replacements: { facilityId, transactionDate },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const payeeKeys = [supplierNumber, payeeName]
      .map(norm)
      .filter((key) => key.length >= 2);

    for (const row of ledgerRows || []) {
      if (!payeeHits(row, payeeKeys)) continue;
      considerMatch(
        matches,
        {
          reference: row.reference_number || "",
          date: row.transaction_date,
          amount: row.debit_total,
          narration: row.purpose_of_payment || row.transaction_description,
          type: "ledger",
        },
        criteria,
      );
    }

    return res.json({
      success: true,
      matches: dedupe(matches).slice(0, 8),
    });
  } catch (error) {
    console.error("checkSimilarPayment:", error);
    return res.status(500).json({
      success: false,
      message: "Could not check similar payments",
      matches: [],
    });
  }
};

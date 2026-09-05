const db = require("../models");

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
  } catch {
    return {};
  }
}

/** cash | card | transfer | null */
function classifyCollectionMode(mode) {
  const m = String(mode || "")
    .toLowerCase()
    .trim();
  if (m === "cash") return "cash";
  if (m === "card") return "card";
  if (
    m === "bank" ||
    m === "transfer" ||
    m === "bank transfer" ||
    m === "cheque"
  ) {
    return "transfer";
  }
  return null;
}

function classifyTillExpense(mode, paymentMeta) {
  const meta = parseMeta(paymentMeta);
  const tagged = String(meta.till_mode || "").toLowerCase().trim();
  if (tagged === "cash" || tagged === "card" || tagged === "transfer") {
    return tagged;
  }
  const fromMode = classifyCollectionMode(mode);
  if (fromMode) return fromMode;
  if (String(mode || "").toLowerCase() === "bank") return "transfer";
  return null;
}

/**
 * Sum imprest/direct expenses by till mode for a date range.
 * Optional cashierUserId limits to that user's till.
 */
async function loadTillExpenses({
  facilityId,
  fromDate,
  toDate,
  cashierUserId = null,
}) {
  const empty = { cash: 0, card: 0, transfer: 0, lines: [] };
  if (!facilityId) return empty;
  try {
    const where = ["facility_id = :facilityId", "transaction_date BETWEEN :fromDate AND :toDate"];
    const replacements = { facilityId, fromDate, toDate };
    if (cashierUserId) {
      where.push("CAST(user_id AS CHAR) = CAST(:cashierUserId AS CHAR)");
      replacements.cashierUserId = String(cashierUserId);
    }
    const rows = await db.sequelize.query(
      `SELECT id, user_id, reference_display, ref_number, remark,
              mode_of_payment, payment_meta_json, total_payment, transaction_date
       FROM impress
       WHERE ${where.join(" AND ")}`,
      {
        replacements,
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    const totals = { cash: 0, card: 0, transfer: 0 };
    const lines = [];
    for (const row of rows || []) {
      const side = classifyTillExpense(row.mode_of_payment, row.payment_meta_json);
      if (!side) continue;
      const amount = money(row.total_payment);
      totals[side] += amount;
      lines.push({
        id: row.id,
        user_id: row.user_id,
        sale_code: row.reference_display || row.ref_number,
        description: row.remark,
        payment_type: `expense (${side})`,
        till_mode: side,
        amount,
        transaction_date: row.transaction_date,
      });
    }
    return {
      cash: money(totals.cash),
      card: money(totals.card),
      transfer: money(totals.transfer),
      lines,
    };
  } catch (err) {
    console.warn("loadTillExpenses:", err.message);
    return empty;
  }
}

module.exports = {
  money,
  classifyCollectionMode,
  classifyTillExpense,
  loadTillExpenses,
};

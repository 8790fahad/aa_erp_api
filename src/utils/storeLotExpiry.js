"use strict";

const moment = require("moment");

/** Blank, zero, and placeholder dates must not be stored as a lot expiry. */
function normalizeStoreExpiry(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return moment(value).format("YYYY-MM-DD");
  }
  const raw = String(value).trim();
  if (
    !raw ||
    raw === "0000-00-00" ||
    raw === "1111-11-11" ||
    raw.startsWith("0000")
  ) {
    return null;
  }
  const parsed = moment(raw);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
}

/**
 * Pick the stock lot a qty_out should hit (sales, write-off, etc.).
 * Prefer the expiry on the line when present; otherwise FEFO among lots
 * that still have a positive balance at that branch.
 *
 * This prevents ghost lots where stock sits on Exp X but outs post with
 * NULL (or the reverse), which makes Goods Balance ≠ Create Invoice Avail.
 */
async function resolveStockOutExpiry({
  db,
  sku,
  facilityId,
  branchId,
  preferredExpiry = null,
  transaction = null,
}) {
  const fromLine = normalizeStoreExpiry(preferredExpiry);
  if (fromLine) return fromLine;
  if (!db?.sequelize || !sku || !facilityId || !branchId) return null;

  const rows = await db.sequelize.query(
    `SELECT
       CASE
         WHEN se.expiry_date IS NULL
           OR se.expiry_date <= '2000-01-01'
           OR se.expiry_date = '1111-11-11'
         THEN NULL
         ELSE DATE(se.expiry_date)
       END AS expiry_day,
       ROUND(SUM(se.qty_in) - SUM(se.qty_out), 4) AS balance
     FROM store_entries se
     WHERE se.facilityId = :facilityId
       AND se.product_id = :sku
       AND se.branchId = :branchId
       AND LOWER(TRIM(IFNULL(se.branch_name, ''))) IN (
         'for sales', 'for sale', 'resalable', 'finished good', 'finished goods'
       )
     GROUP BY
       CASE
         WHEN se.expiry_date IS NULL
           OR se.expiry_date <= '2000-01-01'
           OR se.expiry_date = '1111-11-11'
         THEN NULL
         ELSE DATE(se.expiry_date)
       END
     HAVING balance > 0.0001
     ORDER BY
       CASE WHEN expiry_day IS NULL THEN 1 ELSE 0 END,
       expiry_day ASC`,
    {
      replacements: {
        facilityId: String(facilityId),
        sku: String(sku),
        branchId: Number(branchId),
      },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );

  const first = rows?.[0];
  if (!first) return null;
  return normalizeStoreExpiry(first.expiry_day);
}

module.exports = {
  normalizeStoreExpiry,
  resolveStockOutExpiry,
};

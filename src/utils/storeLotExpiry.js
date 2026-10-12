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

/** Stock is not split by expiry lot, so outs must not stamp an expiry date. */
async function resolveStockOutExpiry() {
  return null;
}

module.exports = {
  normalizeStoreExpiry,
  resolveStockOutExpiry,
};

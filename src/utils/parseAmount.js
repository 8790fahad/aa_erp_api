/**
 * Parse monetary amounts from numbers or formatted strings (e.g. "65,000.00").
 * Returns null when the value is missing or not a valid non-negative number.
 */
function parseAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

module.exports = { parseAmount };

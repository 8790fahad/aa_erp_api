function isWalkInCustomer(customerOrType) {
  const raw =
    typeof customerOrType === "string"
      ? customerOrType
      : customerOrType?.customer_type;
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return t === "walk-in" || t === "walkin" || t === "walking";
}

function normalizeCustomerKind(customerOrType) {
  return isWalkInCustomer(customerOrType) ? "walk-in" : "customer";
}

/** Walk-in: 0. Empty/null: unlimited (null). 0: no credit. Otherwise the amount. */
function parseCreditLimitValue(value, { walkIn = false } = {}) {
  if (walkIn) return 0;
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  const n = parseFloat(s.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isUnlimitedCreditLimit(value, { walkIn = false } = {}) {
  if (walkIn) return false;
  return parseCreditLimitValue(value) == null;
}

module.exports = {
  isWalkInCustomer,
  normalizeCustomerKind,
  parseCreditLimitValue,
  isUnlimitedCreditLimit,
};

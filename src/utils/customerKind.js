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

module.exports = {
  isWalkInCustomer,
  normalizeCustomerKind,
};

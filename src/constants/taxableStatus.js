"use strict";

/** Canonical product VAT / taxable statuses. */
const TAXABLE_STATUS_VALUES = [
  "Taxable",
  "Non-Taxable",
  "Exempted",
  "Zero Rated",
];

const LEGACY_NOT_TAXABLE = "Not Taxable";

/**
 * Normalize free-text / legacy taxable values to a canonical status.
 * @param {unknown} value
 * @param {string} [fallback="Taxable"]
 */
function normalizeTaxableStatus(value, fallback = "Taxable") {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!raw) return fallback;
  if (raw === "taxable") return "Taxable";
  if (
    raw === "non taxable" ||
    raw === "nontaxable" ||
    raw === "not taxable" ||
    raw === "non-taxable"
  ) {
    return "Non-Taxable";
  }
  if (raw === "exempted" || raw === "exempt" || raw === "exemption") {
    return "Exempted";
  }
  if (
    raw === "zero rated" ||
    raw === "zerorated" ||
    raw === "zero rate" ||
    raw === "0 rated"
  ) {
    return "Zero Rated";
  }
  // Keep unknown values only if already canonical
  if (TAXABLE_STATUS_VALUES.includes(String(value).trim())) {
    return String(value).trim();
  }
  if (String(value).trim() === LEGACY_NOT_TAXABLE) return "Non-Taxable";
  return fallback;
}

/** True when VAT should be calculated / applied on this product. */
function isProductTaxable(value) {
  return normalizeTaxableStatus(value, "") === "Taxable";
}

function isValidTaxableStatus(value) {
  const n = normalizeTaxableStatus(value, "");
  return TAXABLE_STATUS_VALUES.includes(n);
}

module.exports = {
  TAXABLE_STATUS_VALUES,
  LEGACY_NOT_TAXABLE,
  normalizeTaxableStatus,
  isProductTaxable,
  isValidTaxableStatus,
};

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

/** True when output VAT is charged on the selling price. */
function isProductTaxable(value) {
  return normalizeTaxableStatus(value, "") === "Taxable";
}

/**
 * True when the recorded cost includes 7.5% input VAT.
 * Only Taxable products. Zero Rated, Non-Taxable, and Exempted are 0.
 */
function costIncludesInputVat(value) {
  return normalizeTaxableStatus(value, "") === "Taxable";
}

/** Nigeria input VAT. Inclusive: VAT = cost × 7.5 / 107.5. */
const INCLUSIVE_INPUT_VAT_PERCENT = 7.5;

/**
 * Line VAT inside an inclusive unit cost.
 * Only Taxable products. Zero Rated, Non-Taxable, and Exempted are 0.
 */
function inclusiveInputVatAmount(unitCost, qty, taxable) {
  if (!costIncludesInputVat(taxable)) return 0;
  const unit = Number(unitCost) || 0;
  const q = Number(qty) || 0;
  if (unit <= 0 || q <= 0) return 0;
  const rate = INCLUSIVE_INPUT_VAT_PERCENT / 100;
  const unitVat = unit - unit / (1 + rate);
  return Number((q * unitVat).toFixed(2));
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
  costIncludesInputVat,
  isValidTaxableStatus,
  INCLUSIVE_INPUT_VAT_PERCENT,
  inclusiveInputVatAmount,
};

"use strict";

/** Nigeria Tax Act 2026 — default progressive bands (annual chargeable income). */
const DEFAULT_TAX_BANDS_2026 = [
  { width: 800000, rate: 0 },
  { width: 2200000, rate: 0.15 },
  { width: 9000000, rate: 0.18 },
  { width: 13000000, rate: 0.21 },
  { width: 25000000, rate: 0.23 },
  { width: null, rate: 0.25 },
];

const DEFAULT_PAYE_SETTINGS_2026 = {
  assessmentYear: 2026,
  rentReliefRate: 20,
  rentReliefCap: 500000,
  nhfRate: 2.5,
  nhfBase: "basic",
  nhisRate: 5,
  nhisBase: "basic",
  pensionRate: 8,
  pensionBase: "taxable",
  taxBands: DEFAULT_TAX_BANDS_2026,
  autoCalculation: true,
};

/** Map legacy base codes to current UI values. */
function normalizePayeBase(base) {
  const b = String(base || "").toLowerCase();
  if (b === "bht") return "taxable";
  if (b === "basic" || b === "taxable" || b === "gross") return b;
  return "basic";
}

function parseTaxBands(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : DEFAULT_TAX_BANDS_2026;
    } catch {
      return DEFAULT_TAX_BANDS_2026;
    }
  }
  return DEFAULT_TAX_BANDS_2026;
}

function normalizePayeSettings(raw = {}) {
  return {
    ...DEFAULT_PAYE_SETTINGS_2026,
    ...raw,
    nhfBase: normalizePayeBase(raw.nhfBase ?? DEFAULT_PAYE_SETTINGS_2026.nhfBase),
    nhisBase: normalizePayeBase(raw.nhisBase ?? DEFAULT_PAYE_SETTINGS_2026.nhisBase),
    pensionBase: normalizePayeBase(
      raw.pensionBase ?? DEFAULT_PAYE_SETTINGS_2026.pensionBase,
    ),
    taxBands: parseTaxBands(raw.taxBands),
  };
}

function parseRatePercent(value) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}

function toAnnualAmount(value, payEntryFrequency = "monthly") {
  const n = parseFloat(value) || 0;
  return payEntryFrequency === "annual" ? n : n * 12;
}

function resolveTaxableAllowances(components) {
  if (components.taxableAllowances != null && components.taxableAllowances !== "") {
    return parseFloat(components.taxableAllowances) || 0;
  }
  return (
    (parseFloat(components.housing) || 0) +
    (parseFloat(components.transport) || 0) +
    (parseFloat(components.otherAllowances) || 0)
  );
}

function componentBase(base, components) {
  const basic = parseFloat(components.basic) || 0;
  const housing = parseFloat(components.housing) || 0;
  const transport = parseFloat(components.transport) || 0;
  const taxableAllowances = resolveTaxableAllowances(components);
  const nonTaxableAllowances = parseFloat(components.nonTaxableAllowances) || 0;
  const bonus = parseFloat(components.bonus) || 0;
  const taxableBonus =
    components.taxableBonus != null
      ? parseFloat(components.taxableBonus) || 0
      : components.bonusIsTaxable === false
        ? 0
        : bonus;
  const nonTaxableBonus =
    components.nonTaxableBonus != null
      ? parseFloat(components.nonTaxableBonus) || 0
      : components.bonusIsTaxable === false
        ? bonus
        : 0;
  const taxableGross = basic + taxableAllowances + taxableBonus;
  const gross = taxableGross + nonTaxableAllowances + nonTaxableBonus;

  switch (normalizePayeBase(base)) {
    case "basic":
      return basic;
    case "taxable":
      return taxableGross;
    case "gross":
      return gross;
    default:
      // legacy bht already normalized to taxable; keep housing+transport fallback
      return basic + housing + transport;
  }
}

function applyTaxBands(chargeableIncome, bands) {
  let remaining = Math.max(parseFloat(chargeableIncome) || 0, 0);
  let totalTax = 0;

  for (const band of bands || []) {
    if (remaining <= 0) break;
    const rate = parseRatePercent(band.rate);
    const width =
      band.width === null || band.width === undefined || band.width === ""
        ? remaining
        : parseFloat(band.width);
    const taxableInBand = Math.min(remaining, width);
    totalTax += taxableInBand * rate;
    remaining -= taxableInBand;
  }

  return totalTax;
}

/**
 * Compute Nigeria 2026 PAYE for one employee.
 * Chargeable income uses taxable pay only (basic + taxable allowances + bonus).
 * Non-taxable allowances are paid but excluded from PAYE chargeable income.
 */
function computePAYE(input = {}) {
  const settings = normalizePayeSettings(input.settings || {});
  const payEntryFrequency = input.payEntryFrequency || "monthly";

  const annualBasic = toAnnualAmount(input.basic, payEntryFrequency);
  const annualHousing = toAnnualAmount(input.housing, payEntryFrequency);
  const annualTransport = toAnnualAmount(input.transport, payEntryFrequency);
  const annualOther = toAnnualAmount(input.otherAllowances, payEntryFrequency);
  const annualTaxableAllowances = toAnnualAmount(
    input.taxableAllowances != null
      ? input.taxableAllowances
      : (parseFloat(input.housing) || 0) +
          (parseFloat(input.transport) || 0) +
          (parseFloat(input.otherAllowances) || 0),
    payEntryFrequency,
  );
  const annualNonTaxable = toAnnualAmount(
    input.nonTaxableAllowances,
    payEntryFrequency,
  );
  const annualBonus = toAnnualAmount(input.bonus, payEntryFrequency);
  const bonusIsTaxable = input.bonusIsTaxable !== false && input.bonusIsTaxable !== 0;
  const annualTaxableBonus =
    input.taxableBonus != null
      ? toAnnualAmount(input.taxableBonus, payEntryFrequency)
      : bonusIsTaxable
        ? annualBonus
        : 0;
  const annualNonTaxableBonus =
    input.nonTaxableBonus != null
      ? toAnnualAmount(input.nonTaxableBonus, payEntryFrequency)
      : bonusIsTaxable
        ? 0
        : annualBonus;
  const annualRent = parseFloat(input.annualRent) || 0;

  const taxableGross = annualBasic + annualTaxableAllowances + annualTaxableBonus;
  const gross = taxableGross + annualNonTaxable + annualNonTaxableBonus;

  const components = {
    basic: annualBasic,
    housing: annualHousing,
    transport: annualTransport,
    otherAllowances: annualOther,
    taxableAllowances: annualTaxableAllowances,
    nonTaxableAllowances: annualNonTaxable,
    bonus: annualBonus,
    taxableBonus: annualTaxableBonus,
    nonTaxableBonus: annualNonTaxableBonus,
    bonusIsTaxable,
  };

  const rentReliefRate = parseRatePercent(settings.rentReliefRate);
  const rentReliefCap = parseFloat(settings.rentReliefCap) || 0;
  const nhfRate = parseRatePercent(settings.nhfRate);
  const nhisRate = parseRatePercent(settings.nhisRate);
  const pensionRate = parseRatePercent(settings.pensionRate);

  const rentRelief =
    input.appliesRent !== false
      ? Math.min(annualRent * rentReliefRate, rentReliefCap)
      : 0;
  const nhf =
    input.appliesNHF !== false
      ? componentBase(settings.nhfBase, components) * nhfRate
      : 0;
  const nhis =
    input.appliesNHIS !== false
      ? componentBase(settings.nhisBase, components) * nhisRate
      : 0;
  const pension =
    input.appliesPension !== false
      ? componentBase(settings.pensionBase, components) * pensionRate
      : 0;

  const totalDeductions = rentRelief + nhf + nhis + pension;
  const chargeableIncome = Math.max(taxableGross - totalDeductions, 0);
  const annualTax = applyTaxBands(chargeableIncome, settings.taxBands);
  const monthlyTax = annualTax / 12;

  return {
    gross,
    taxableGross,
    nonTaxableAllowances: annualNonTaxable,
    taxableBonus: annualTaxableBonus,
    nonTaxableBonus: annualNonTaxableBonus,
    rentRelief,
    nhf,
    nhis,
    pension,
    totalDeductions,
    chargeableIncome,
    annualTax,
    monthlyTax,
    computedMonthlyTax: monthlyTax,
  };
}

module.exports = {
  DEFAULT_TAX_BANDS_2026,
  DEFAULT_PAYE_SETTINGS_2026,
  parseTaxBands,
  normalizePayeSettings,
  normalizePayeBase,
  componentBase,
  applyTaxBands,
  computePAYE,
  toAnnualAmount,
};

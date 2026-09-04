/**
 * Decide if a posted sale tax is inclusive or exclusive.
 * Tax-master flags can disagree with Create Invoice; the posted amount vs line
 * subtotal is the source of truth (e.g. 7.5% of 60,000 inclusive = 4,186.05,
 * exclusive = 4,500).
 */
function inferTaxInclusiveType(tax, lineSubtotal, vatPolicy = "") {
  const rate = Number(tax?.rate) || 0;
  const amt = Number(tax?.amount ?? tax?.cost ?? 0) || 0;
  const base = Number(lineSubtotal) || 0;
  if (rate > 0 && base > 0 && amt > 0) {
    const inclusiveAmt = (base * rate) / (100 + rate);
    const exclusiveAmt = (base * rate) / 100;
    const dInc = Math.abs(amt - inclusiveAmt);
    const dExc = Math.abs(amt - exclusiveAmt);
    if (dInc <= 0.05) return "inclusive";
    if (dExc <= 0.05) return "exclusive";
    return dInc <= dExc ? "inclusive" : "exclusive";
  }

  const inc = String(tax?.inclusive_type || "").toLowerCase();
  if (inc === "inclusive" || inc === "exclusive") return inc;
  const typ = String(tax?.tax_type || "").toLowerCase();
  if (typ === "inclusive") return "inclusive";
  if (typ === "exclusive") return "exclusive";

  const policy = String(vatPolicy || "").toLowerCase();
  if (policy === "vat_inclusive") return "inclusive";
  return "exclusive";
}

module.exports = { inferTaxInclusiveType };

/**
 * Report balancing rules (normal balances):
 * A. ASSET   = Sum(Dr) − Sum(Cr)
 * B. LIABILITY = Sum(Cr) − Sum(Dr)
 * C. EQUITY  = Sum(Cr) − Sum(Dr)
 * D. REVENUE = Sum(Cr) − Sum(Dr)
 * E. EXPENSE = Sum(Dr) − Sum(Cr)  (same as assets)
 */

const CREDIT_NORMAL = new Set(["LIABILITY", "EQUITY", "REVENUE"]);
const DEBIT_NORMAL = new Set(["ASSET", "EXPENSE"]);

function normalizeAccountNature(nature) {
  return String(nature || "")
    .trim()
    .toUpperCase();
}

/** True when the account's normal balance is credit (Liabilities, Equity, Revenue). */
function isCreditNormalNature(nature) {
  return CREDIT_NORMAL.has(normalizeAccountNature(nature));
}

/** True when the account's normal balance is debit (Assets, Expenses). */
function isDebitNormalNature(nature) {
  const n = normalizeAccountNature(nature);
  return !n || DEBIT_NORMAL.has(n);
}

/**
 * Signed period/closing balance for statement & ledger display.
 * Positive = normal balance side for that nature.
 */
function signedBalance(nature, debit, credit) {
  const dr = parseFloat(debit) || 0;
  const cr = parseFloat(credit) || 0;
  if (isCreditNormalNature(nature)) {
    return Number((cr - dr).toFixed(4));
  }
  return Number((dr - cr).toFixed(4));
}

/** Contribution of one GL line to a nature-signed running balance. */
function signedMovement(nature, debit, credit) {
  return signedBalance(nature, debit, credit);
}

/**
 * Infer nature from first digit of AaErp CoA when account_nature is missing.
 * 1 = ASSET, 2/9 = LIABILITY, 3 = EQUITY, 4–6 = REVENUE, 7–8 = EXPENSE
 */
function inferNatureFromCode(accountCode) {
  const first = String(accountCode || "").trim().charAt(0);
  if (first === "1") return "ASSET";
  if (first === "2" || first === "9") return "LIABILITY";
  if (first === "3") return "EQUITY";
  if (first === "4" || first === "5" || first === "6") return "REVENUE";
  if (first === "7" || first === "8") return "EXPENSE";
  return "ASSET";
}

function resolveAccountNature(nature, accountCode) {
  const n = normalizeAccountNature(nature);
  if (n) return n;
  return inferNatureFromCode(accountCode);
}

module.exports = {
  CREDIT_NORMAL,
  DEBIT_NORMAL,
  normalizeAccountNature,
  isCreditNormalNature,
  isDebitNormalNature,
  signedBalance,
  signedMovement,
  inferNatureFromCode,
  resolveAccountNature,
};
